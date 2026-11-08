mod common;

use std::{
    convert::Infallible,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::{
    body::Body,
    extract::Request,
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use bytes::Bytes;
use common::{
    body_stream, event_names, outcome, prepare_value, request, request_with, run, service,
    MockServer, CREDENTIAL,
};
use futures_util::StreamExt;
use http_body_util::BodyExt;
use serde_json::Value;
use tokio::sync::Notify;
use tower::ServiceExt;

#[tokio::test]
async fn successful_stream_forwards_security_context_without_exposing_secrets() {
    let provider_calls = Arc::new(AtomicUsize::new(0));
    let provider_counter = provider_calls.clone();
    let provider = MockServer::spawn(Router::new().route(
        "/v1/chat/completions",
        post(move |request: Request| {
            let provider_counter = provider_counter.clone();
            async move {
                provider_counter.fetch_add(1, Ordering::SeqCst);
                assert_eq!(
                    "Bearer provider-secret",
                    request.headers().get("authorization").unwrap()
                );
                let body = request.into_body().collect().await.unwrap().to_bytes();
                let payload: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!("mock-model", payload["model"]);
                assert_eq!(true, payload["stream"]);
                assert_eq!("private prepared prompt", payload["messages"][0]["content"]);
                body_stream(vec![
                    "data: {\"choices\":[{\"delta\":{\"content\":\"  <thi\"}}]}\r\n\r\n",
                    "data: {\"choices\":[{\"delta\":{\"content\":\"nk>secret</think>Betreff: Grüße ✓\\n\\nHallo\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"secret\"},{\"type\":\"text\",\"text\":\",\"},{\"type\":\"text\",\"text\":\" Welt\"}]}}]}\n\n",
                    "data: {\"type\":\"response.completed\",\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n",
                ])
            }
        }),
    ))
    .await;

    let prepare_calls = Arc::new(AtomicUsize::new(0));
    let prepare_counter = prepare_calls.clone();
    let provider_url = provider.url("/v1/chat/completions");
    let prepare_request_id = Arc::new(std::sync::Mutex::new(String::new()));
    let captured_id = prepare_request_id.clone();
    let prepare = MockServer::spawn(Router::new().route(
        "/prepare",
        post(move |request: Request| {
            let prepare_counter = prepare_counter.clone();
            let provider_url = provider_url.clone();
            let captured_id = captured_id.clone();
            async move {
                prepare_counter.fetch_add(1, Ordering::SeqCst);
                let headers = request.headers();
                assert_eq!("snappymail=session-secret", header(headers, "cookie"));
                assert_eq!("csrf-secret", header(headers, "x-sm-token"));
                assert_eq!("same-origin", header(headers, "sec-fetch-site"));
                assert_eq!("cors", header(headers, "sec-fetch-mode"));
                assert_eq!("empty", header(headers, "sec-fetch-dest"));
                assert_eq!("https://mail.example.test", header(headers, "origin"));
                assert_eq!("application/json", header(headers, "content-type"));
                assert_eq!(CREDENTIAL, header(headers, "x-snappy-proxy-key"));
                let request_id = header(headers, "x-request-id").to_owned();
                uuid::Uuid::parse_str(&request_id).unwrap();
                *captured_id.lock().unwrap() = request_id;
                let body = request.into_body().collect().await.unwrap().to_bytes();
                let draft: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!("reply", draft["mode"]);
                assert!(draft.get("provider_url").is_none());
                Json(prepare_value(&provider_url))
            }
        }),
    ))
    .await;

    let (proxy, app) = service(prepare.url("/prepare"), &[]);
    let response = app
        .oneshot(request(r#"{"mode":"reply","instruction":"Antwort"}"#))
        .await
        .unwrap();
    assert_eq!(StatusCode::OK, response.status());
    assert_eq!(
        "text/event-stream; charset=utf-8",
        response.headers()["content-type"]
    );
    assert_eq!("no", response.headers()["x-accel-buffering"]);
    let response_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let result = outcome(response).await;
    assert_eq!(
        vec!["start", "delta", "delta", "done"],
        event_names(&result.events)
    );
    assert_eq!("Betreff: Grüße ✓\n\nHallo", result.events[1].1["text"]);
    assert_eq!(", Welt", result.events[2].1["text"]);
    assert_eq!("Grüße ✓", result.events[3].1["subject"]);
    assert_eq!("Hallo, Welt", result.events[3].1["body"]);
    assert_eq!(5, result.events[3].1["usage"]["total_tokens"]);
    assert_eq!(response_id, prepare_request_id.lock().unwrap().as_str());
    assert_eq!(1, prepare_calls.load(Ordering::SeqCst));
    assert_eq!(1, provider_calls.load(Ordering::SeqCst));
    for secret in [
        "provider-secret",
        "session-secret",
        "csrf-secret",
        CREDENTIAL,
        "private prepared prompt",
    ] {
        assert!(
            !result.raw.contains(secret),
            "downstream leaked secret material"
        );
    }
    assert_eq!(16, proxy.permits().preparation_available);
    assert_eq!(8, proxy.permits().upstream_available);
    assert_eq!(2, proxy.account_permits("opaque-account-key"));
}

#[tokio::test]
async fn every_prepare_rejection_means_zero_provider_calls() {
    for (status, code) in [
        (StatusCode::FORBIDDEN, "invalid_csrf"),
        (StatusCode::UNAUTHORIZED, "unauthenticated"),
        (StatusCode::FORBIDDEN, "feature_disabled"),
        (StatusCode::FORBIDDEN, "consent_required"),
        (StatusCode::BAD_REQUEST, "invalid_request"),
    ] {
        let provider_calls = Arc::new(AtomicUsize::new(0));
        let counter = provider_calls.clone();
        let provider = MockServer::spawn(Router::new().route(
            "/v1/chat/completions",
            post(move || {
                let counter = counter.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    StatusCode::OK
                }
            }),
        ))
        .await;
        let provider_url = provider.url("/v1/chat/completions");
        let prepare = MockServer::spawn(Router::new().route(
            "/prepare",
            post(move || async move {
                (
                    status,
                    Json(serde_json::json!({
                        "code": code,
                        "error": "private internal detail provider-secret"
                    })),
                )
            }),
        ))
        .await;
        // Keep the URL valid even though authorization must prevent its use.
        let _ = provider_url;
        let (proxy, app) = service(prepare.url("/prepare"), &[]);
        let result = run(app, request("{}")).await;
        assert_eq!(vec!["error"], event_names(&result.events));
        assert_eq!(code, result.events[0].1["code"]);
        assert!(!result.raw.contains("private internal detail"));
        assert_eq!(0, provider_calls.load(Ordering::SeqCst));
        assert_eq!(16, proxy.permits().preparation_available);
        assert_eq!(8, proxy.permits().upstream_available);
    }
}

#[tokio::test]
async fn malformed_browser_input_never_reaches_prepare_or_provider() {
    let prepare_calls = Arc::new(AtomicUsize::new(0));
    let counter = prepare_calls.clone();
    let prepare = MockServer::spawn(Router::new().route(
        "/prepare",
        post(move || {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Json(serde_json::json!({}))
            }
        }),
    ))
    .await;
    let cases = vec![
        (request("{"), "invalid_json"),
        (request("[]"), "invalid_request"),
        (
            request(r#"{"provider_url":"http://attacker.invalid"}"#),
            "invalid_request",
        ),
        (request(r#"{"uids":[1.0]}"#), "invalid_uids"),
        (
            request_with(Method::POST, "{}", "text/plain"),
            "invalid_content_type",
        ),
        (
            request_with(Method::GET, "{}", "application/json"),
            "method_not_allowed",
        ),
        (request("x".repeat(65_537)), "body_too_large"),
    ];
    for (request, expected) in cases {
        let (_, app) = service(prepare.url("/prepare"), &[]);
        let result = run(app, request).await;
        assert_eq!(vec!["error"], event_names(&result.events));
        assert_eq!(expected, result.events[0].1["code"]);
    }
    assert_eq!(0, prepare_calls.load(Ordering::SeqCst));
}

#[tokio::test]
async fn malformed_incomplete_and_http_upstream_failures_are_terminal() {
    let cases: Vec<(Vec<&'static str>, Option<StatusCode>, &str)> = vec![
        (
            vec!["data: {not-json}\n\n"],
            None,
            "upstream_malformed_json",
        ),
        (
            vec!["data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"],
            None,
            "upstream_incomplete",
        ),
        (
            vec!["private provider error"],
            Some(StatusCode::TOO_MANY_REQUESTS),
            "upstream_http",
        ),
    ];
    for (chunks, status, expected) in cases {
        let provider_calls = Arc::new(AtomicUsize::new(0));
        let counter = provider_calls.clone();
        let provider = MockServer::spawn(Router::new().route(
            "/v1/chat/completions",
            post(move || {
                let counter = counter.clone();
                let chunks = chunks.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    if let Some(status) = status {
                        status.into_response()
                    } else {
                        body_stream(chunks).into_response()
                    }
                }
            }),
        ))
        .await;
        let value = prepare_value(&provider.url("/v1/chat/completions"));
        let prepare = successful_prepare(value).await;
        let (proxy, app) = service(prepare.url("/prepare"), &[]);
        let result = run(app, request("{}")).await;
        assert_eq!("error", result.events.last().unwrap().0);
        assert_eq!(expected, result.events.last().unwrap().1["code"]);
        assert!(!event_names(&result.events).contains(&"done"));
        assert!(!result.raw.contains("private provider error"));
        assert_eq!(
            1,
            provider_calls.load(Ordering::SeqCst),
            "request was retried"
        );
        assert_eq!(8, proxy.permits().upstream_available);
    }
}

#[tokio::test]
async fn redirects_are_not_followed_and_remote_http_is_rejected() {
    let redirected_calls = Arc::new(AtomicUsize::new(0));
    let counter = redirected_calls.clone();
    let provider_calls = Arc::new(AtomicUsize::new(0));
    let provider_counter = provider_calls.clone();
    let provider = MockServer::spawn(
        Router::new()
            .route(
                "/start",
                post(move || {
                    let provider_counter = provider_counter.clone();
                    async move {
                        provider_counter.fetch_add(1, Ordering::SeqCst);
                        Response::builder()
                            .status(StatusCode::FOUND)
                            .header("location", "/redirected")
                            .body(Body::empty())
                            .unwrap()
                    }
                }),
            )
            .route(
                "/redirected",
                post(move || {
                    let counter = counter.clone();
                    async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                        StatusCode::OK
                    }
                }),
            ),
    )
    .await;
    let prepare = successful_prepare(prepare_value(&provider.url("/start"))).await;
    let (_, app) = service(prepare.url("/prepare"), &[]);
    let result = run(app, request("{}")).await;
    assert_eq!("upstream_http", result.events.last().unwrap().1["code"]);
    assert_eq!(1, provider_calls.load(Ordering::SeqCst));
    assert_eq!(0, redirected_calls.load(Ordering::SeqCst));

    let mut value = prepare_value(&provider.url("/start"));
    value["allow_local_provider"] = Value::Bool(false);
    let prepare = successful_prepare(value).await;
    let (_, app) = service(prepare.url("/prepare"), &[]);
    let result = run(app, request("{}")).await;
    assert_eq!("provider_not_configured", result.events[0].1["code"]);
    assert_eq!(1, provider_calls.load(Ordering::SeqCst));
}

#[tokio::test]
async fn cancellation_stops_pending_upstream_and_restores_permits() {
    let provider_entered = Arc::new(Notify::new());
    let provider_dropped = Arc::new(Notify::new());
    let entered = provider_entered.clone();
    let dropped = provider_dropped.clone();
    let provider = MockServer::spawn(Router::new().route(
        "/stream",
        post(move || {
            let entered = entered.clone();
            let dropped = dropped.clone();
            async move {
                entered.notify_one();
                let guard = DropGuard(dropped);
                let first = futures_util::stream::once(async {
                    Ok::<Bytes, Infallible>(Bytes::from_static(
                        b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
                    ))
                });
                let pending = futures_util::stream::once(async move {
                    let _guard = guard;
                    std::future::pending::<()>().await;
                    unreachable!()
                });
                Body::from_stream(first.chain(pending))
            }
        }),
    ))
    .await;
    let prepare = successful_prepare(prepare_value(&provider.url("/stream"))).await;
    let (proxy, app) = service(prepare.url("/prepare"), &[]);
    let response = app.oneshot(request("{}")).await.unwrap();
    provider_entered.notified().await;
    let mut body = response.into_body();
    let _start = body.frame().await.unwrap().unwrap();
    let _delta = body.frame().await.unwrap().unwrap();
    drop(body);
    tokio::time::timeout(Duration::from_secs(2), provider_dropped.notified())
        .await
        .expect("upstream body was not cancelled");
    assert_eq!(16, proxy.permits().preparation_available);
    assert_eq!(8, proxy.permits().upstream_available);
    assert_eq!(2, proxy.account_permits("opaque-account-key"));
}

#[tokio::test]
async fn slow_consumer_applies_backpressure_and_drop_releases_permits() {
    let provider = MockServer::spawn(Router::new().route(
        "/stream",
        post(|| async {
            let mut chunks = Vec::new();
            chunks.push("data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n");
            chunks.extend(std::iter::repeat_n(
                "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n",
                100,
            ));
            chunks.push("data: [DONE]\n\n");
            body_stream(chunks)
        }),
    ))
    .await;
    let prepare = successful_prepare(prepare_value(&provider.url("/stream"))).await;
    let (proxy, app) = service(
        prepare.url("/prepare"),
        &[("SNAPPY_AI_PROXY_CHANNEL_CAPACITY", "1")],
    );
    let response = app.oneshot(request("{}")).await.unwrap();
    let mut body = response.into_body();
    let _start = body.frame().await.unwrap().unwrap();
    let second = body.frame().await.unwrap().unwrap();
    let second = second.into_data().unwrap();
    assert!(
        std::str::from_utf8(&second)
            .unwrap()
            .contains("event: delta"),
        "unexpected second event: {}",
        String::from_utf8_lossy(&second)
    );
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(7, proxy.permits().upstream_available);
    drop(body);
    tokio::time::timeout(Duration::from_secs(2), async {
        while proxy.permits().upstream_available != 8 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("slow-client drop did not release upstream permit");
    assert_eq!(16, proxy.permits().preparation_available);
}

#[tokio::test]
async fn bounded_prepare_and_per_account_limits_shed_excess_work() {
    let prepare_entered = Arc::new(Notify::new());
    let entered = prepare_entered.clone();
    let prepare_calls = Arc::new(AtomicUsize::new(0));
    let counter = prepare_calls.clone();
    let prepare = MockServer::spawn(Router::new().route(
        "/prepare",
        post(move || {
            let entered = entered.clone();
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                entered.notify_one();
                std::future::pending::<()>().await
            }
        }),
    ))
    .await;
    let (proxy, app) = service(
        prepare.url("/prepare"),
        &[("SNAPPY_AI_PROXY_PREPARE_PERMITS", "1")],
    );
    let first = app.clone().oneshot(request("{}")).await.unwrap();
    prepare_entered.notified().await;
    let second = run(app, request("{}")).await;
    assert_eq!("busy", second.events[0].1["code"]);
    assert_eq!(1, prepare_calls.load(Ordering::SeqCst));
    drop(first);
    tokio::time::timeout(Duration::from_secs(2), async {
        while proxy.permits().preparation_available != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    let provider_entered = Arc::new(Notify::new());
    let entered = provider_entered.clone();
    let provider_calls = Arc::new(AtomicUsize::new(0));
    let counter = provider_calls.clone();
    let provider = MockServer::spawn(Router::new().route(
        "/stream",
        post(move || {
            let entered = entered.clone();
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                entered.notify_one();
                Body::from_stream(futures_util::stream::pending::<Result<Bytes, Infallible>>())
            }
        }),
    ))
    .await;
    let prepare = successful_prepare(prepare_value(&provider.url("/stream"))).await;
    let (proxy, app) = service(
        prepare.url("/prepare"),
        &[("SNAPPY_AI_PROXY_PER_ACCOUNT_PERMITS", "1")],
    );
    let first = app.clone().oneshot(request("{}")).await.unwrap();
    provider_entered.notified().await;
    let second = run(app, request("{}")).await;
    assert_eq!("busy", second.events[0].1["code"]);
    assert_eq!(1, provider_calls.load(Ordering::SeqCst));
    drop(first);
    tokio::time::timeout(Duration::from_secs(2), async {
        while proxy.permits().upstream_available != 8 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(1, proxy.account_permits("opaque-account-key"));
}

#[tokio::test]
async fn global_upstream_limit_sheds_other_accounts_and_releases_on_drop() {
    let provider_entered = Arc::new(Notify::new());
    let entered = provider_entered.clone();
    let provider_calls = Arc::new(AtomicUsize::new(0));
    let counter = provider_calls.clone();
    let provider = MockServer::spawn(Router::new().route(
        "/stream",
        post(move || {
            let entered = entered.clone();
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                entered.notify_one();
                Body::from_stream(futures_util::stream::pending::<Result<Bytes, Infallible>>())
            }
        }),
    ))
    .await;
    let provider_url = provider.url("/stream");
    let prepare = MockServer::spawn(Router::new().route(
        "/prepare",
        post(move |request: Request| {
            let provider_url = provider_url.clone();
            async move {
                let body = request.into_body().collect().await.unwrap().to_bytes();
                let draft: Value = serde_json::from_slice(&body).unwrap();
                let mut value = prepare_value(&provider_url);
                value["account_key"] =
                    Value::String(format!("account-{}", draft["uid"].as_u64().unwrap_or(0)));
                Json(value)
            }
        }),
    ))
    .await;
    let (proxy, app) = service(
        prepare.url("/prepare"),
        &[("SNAPPY_AI_PROXY_UPSTREAM_PERMITS", "1")],
    );
    let first = app.clone().oneshot(request(r#"{"uid":1}"#)).await.unwrap();
    provider_entered.notified().await;
    let second = run(app, request(r#"{"uid":2}"#)).await;
    assert_eq!(vec!["error"], event_names(&second.events));
    assert_eq!("busy", second.events[0].1["code"]);
    assert_eq!(1, provider_calls.load(Ordering::SeqCst));
    assert_eq!(2, proxy.account_permits("account-2"));
    drop(first);
    tokio::time::timeout(Duration::from_secs(2), async {
        while proxy.permits().upstream_available != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(2, proxy.account_permits("account-1"));
}

#[tokio::test]
async fn idle_timeout_is_single_dispatch_and_restores_baseline() {
    let provider_calls = Arc::new(AtomicUsize::new(0));
    let counter = provider_calls.clone();
    let provider = MockServer::spawn(Router::new().route(
        "/stream",
        post(move || {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                std::future::pending::<Response>().await
            }
        }),
    ))
    .await;
    let mut value = prepare_value(&provider.url("/stream"));
    value["timeouts"] = serde_json::json!({"connect_ms":100,"idle_ms":20,"total_ms":200});
    let prepare = successful_prepare(value).await;
    let (proxy, app) = service(prepare.url("/prepare"), &[]);
    let result = run(app, request("{}")).await;
    assert_eq!("upstream_timeout", result.events.last().unwrap().1["code"]);
    assert_eq!(1, provider_calls.load(Ordering::SeqCst));
    assert_eq!(8, proxy.permits().upstream_available);
}

#[tokio::test]
async fn prepare_and_accumulated_upstream_bodies_are_bounded() {
    let provider_calls = Arc::new(AtomicUsize::new(0));
    let counter = provider_calls.clone();
    let provider = MockServer::spawn(Router::new().route(
        "/stream",
        post(move || {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                body_stream(vec![
                    "data: {\"choices\":[{\"delta\":{\"content\":\"too much text\"}}]}\n\n",
                    "data: [DONE]\n\n",
                ])
            }
        }),
    ))
    .await;
    let prepare = successful_prepare(prepare_value(&provider.url("/stream"))).await;
    let (proxy, app) = service(
        prepare.url("/prepare"),
        &[("SNAPPY_AI_PROXY_MAX_PREPARE_BODY_BYTES", "64")],
    );
    let result = run(app, request("{}")).await;
    assert_eq!("invalid_prepare_response", result.events[0].1["code"]);
    assert_eq!(0, provider_calls.load(Ordering::SeqCst));
    assert_eq!(16, proxy.permits().preparation_available);

    let prepare = successful_prepare(prepare_value(&provider.url("/stream"))).await;
    let (proxy, app) = service(
        prepare.url("/prepare"),
        &[("SNAPPY_AI_PROXY_MAX_TEXT_BYTES", "4")],
    );
    let result = run(app, request("{}")).await;
    assert_eq!(
        "upstream_too_large",
        result.events.last().unwrap().1["code"]
    );
    assert!(!event_names(&result.events).contains(&"done"));
    assert_eq!(8, proxy.permits().upstream_available);
}

#[tokio::test]
async fn health_is_minimal_and_does_not_call_any_dependency() {
    let prepare_calls = Arc::new(AtomicUsize::new(0));
    let counter = prepare_calls.clone();
    let prepare = MockServer::spawn(Router::new().route(
        "/prepare",
        post(move || {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }),
    ))
    .await;
    let (_, app) = service(prepare.url("/prepare"), &[]);
    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(StatusCode::OK, response.status());
    assert_eq!(
        "ok\n",
        String::from_utf8(
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec()
        )
        .unwrap()
    );
    assert_eq!(0, prepare_calls.load(Ordering::SeqCst));
}

async fn successful_prepare(value: Value) -> MockServer {
    MockServer::spawn(Router::new().route(
        "/prepare",
        post(move || {
            let value = value.clone();
            async move { Json(value) }
        }),
    ))
    .await
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers.get(name).unwrap().to_str().unwrap()
}

struct DropGuard(Arc<Notify>);

impl Drop for DropGuard {
    fn drop(&mut self) {
        self.0.notify_one();
    }
}
