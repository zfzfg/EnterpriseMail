use std::{collections::HashMap, convert::Infallible, net::SocketAddr};

use axum::{body::Body, http::Method, response::Response, Router};
use http_body_util::BodyExt;
use serde_json::Value;
use snappy_ai_proxy::{Config, ProxyService};
use tokio::task::JoinHandle;
use tower::ServiceExt;

pub const CREDENTIAL: &str = "integration-test-credential-32-bytes";

pub struct MockServer {
    pub address: SocketAddr,
    task: JoinHandle<()>,
}

impl MockServer {
    pub async fn spawn(router: Router) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock server");
        let address = listener.local_addr().expect("mock address");
        let task = tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("mock server failed");
        });
        Self { address, task }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.address, path)
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub fn service(prepare_url: String, overrides: &[(&str, &str)]) -> (ProxyService, Router) {
    let overrides = overrides
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect::<HashMap<_, _>>();
    let config = Config::from_lookup(move |name| match name {
        "SNAPPY_AI_PROXY_SERVICE_CREDENTIAL" => Some(CREDENTIAL.to_owned()),
        "SNAPPY_AI_PROXY_PREPARE_URL" => Some(prepare_url.clone()),
        _ => overrides.get(name).cloned(),
    })
    .expect("test config");
    let service = ProxyService::new(config).expect("proxy service");
    let app = snappy_ai_proxy::router(service.clone());
    (service, app)
}

pub fn prepare_value(provider_url: &str) -> Value {
    serde_json::json!({
        "account_key": "opaque-account-key",
        "messages": [{"role":"user","content":"private prepared prompt"}],
        "provider_url": provider_url,
        "api_key": "provider-secret",
        "model": "mock-model",
        "model_label": "Mock · mock-model",
        "allow_local_provider": true,
        "want_subject": true,
        "options": {"temperature": 0.4, "max_tokens": 1500},
        "timeouts": {"connect_ms": 1000, "idle_ms": 1000, "total_ms": 5000}
    })
}

pub fn request(body: impl Into<Body>) -> axum::extract::Request {
    request_with(Method::POST, body, "application/json")
}

pub fn request_with(
    method: Method,
    body: impl Into<Body>,
    content_type: &'static str,
) -> axum::extract::Request {
    axum::extract::Request::builder()
        .method(method)
        .uri("/api/ai/stream")
        .header("content-type", content_type)
        .header("accept", "text/event-stream")
        .header("cookie", "snappymail=session-secret")
        .header("x-sm-token", "csrf-secret")
        .header("sec-fetch-site", "same-origin")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-dest", "empty")
        .header("origin", "https://mail.example.test")
        .body(body.into())
        .expect("test request")
}

pub struct Outcome {
    pub events: Vec<(String, Value)>,
    pub raw: String,
}

pub async fn run(app: Router, request: axum::extract::Request) -> Outcome {
    let response = app.oneshot(request).await.expect("proxy response");
    outcome(response).await
}

pub async fn outcome(response: Response) -> Outcome {
    let raw = String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .expect("collect downstream")
            .to_bytes()
            .to_vec(),
    )
    .expect("UTF-8 downstream");
    let events = parse_events(&raw);
    Outcome { events, raw }
}

pub fn parse_events(raw: &str) -> Vec<(String, Value)> {
    raw.split("\n\n")
        .filter(|block| !block.is_empty())
        .map(|block| {
            let mut event = None;
            let mut data = None;
            for line in block.lines() {
                if let Some(value) = line.strip_prefix("event: ") {
                    event = Some(value.to_owned());
                }
                if let Some(value) = line.strip_prefix("data: ") {
                    data = Some(value);
                }
            }
            (
                event.expect("SSE event"),
                serde_json::from_str(data.expect("SSE data")).expect("SSE JSON"),
            )
        })
        .collect()
}

pub fn event_names(events: &[(String, Value)]) -> Vec<&str> {
    events.iter().map(|(name, _)| name.as_str()).collect()
}

pub fn body_stream(chunks: Vec<&'static str>) -> Body {
    Body::from_stream(futures_util::stream::iter(
        chunks
            .into_iter()
            .map(|chunk| Ok::<_, Infallible>(chunk.as_bytes().to_vec())),
    ))
}
