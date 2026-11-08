use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{Arc, Mutex, Weak},
};

use axum::{
    body::Body,
    extract::{Request, State},
    http::{
        header::{ACCEPT, AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE},
        HeaderMap, HeaderName, HeaderValue, StatusCode,
    },
    response::Response,
    routing::{any, get},
    Router,
};
use bytes::{Bytes, BytesMut};
use futures_util::StreamExt;
use http_body_util::{BodyExt, Limited};
use reqwest::{redirect::Policy, Client, ClientBuilder};
use serde::Serialize;
use tokio::{
    sync::{mpsc, Semaphore},
    time::timeout,
};
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::{
    config::Config,
    draft,
    error::ProxyError,
    parser::{ParserOutput, SseParser, Usage},
    prepare::{EffectiveTimeouts, PrepareError, PreparedRequest},
    reasoning::ReasoningFilter,
    subject::{php_ltrim, split_subject},
};

const SERVICE_CREDENTIAL_HEADER: &str = "x-snappy-proxy-key";
const REQUEST_ID_HEADER: &str = "x-request-id";
const FORWARDED_HEADERS: [&str; 6] = [
    "cookie",
    "x-sm-token",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
    "origin",
];

#[derive(Clone)]
pub struct ProxyService {
    inner: Arc<Inner>,
}

struct Inner {
    config: Config,
    prepare_client: Client,
    preparation: Arc<Semaphore>,
    upstream: Arc<Semaphore>,
    accounts: AccountLimiters,
}

#[derive(Default)]
struct AccountLimiters {
    per_account: usize,
    semaphores: Mutex<HashMap<String, Weak<Semaphore>>>,
}

impl AccountLimiters {
    fn new(per_account: usize) -> Self {
        Self {
            per_account,
            semaphores: Mutex::new(HashMap::new()),
        }
    }

    fn semaphore(&self, account_key: &str) -> Arc<Semaphore> {
        let mut semaphores = self
            .semaphores
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        semaphores.retain(|_, semaphore| semaphore.strong_count() > 0);
        if let Some(semaphore) = semaphores.get(account_key).and_then(Weak::upgrade) {
            return semaphore;
        }
        let semaphore = Arc::new(Semaphore::new(self.per_account));
        semaphores.insert(account_key.to_owned(), Arc::downgrade(&semaphore));
        semaphore
    }

    fn len(&self) -> usize {
        self.semaphores
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PermitSnapshot {
    pub preparation_available: usize,
    pub upstream_available: usize,
    pub account_entries: usize,
}

impl ProxyService {
    pub fn new(config: Config) -> Result<Self, ProxyError> {
        let prepare_client = client_builder()?
            .connect_timeout(config.prepare_connect_timeout)
            .build()
            .map_err(|_| ProxyError::internal())?;
        Ok(Self {
            inner: Arc::new(Inner {
                preparation: Arc::new(Semaphore::new(config.prepare_permits)),
                upstream: Arc::new(Semaphore::new(config.upstream_permits)),
                accounts: AccountLimiters::new(config.per_account_permits),
                prepare_client,
                config,
            }),
        })
    }

    pub fn permits(&self) -> PermitSnapshot {
        PermitSnapshot {
            preparation_available: self.inner.preparation.available_permits(),
            upstream_available: self.inner.upstream.available_permits(),
            account_entries: self.inner.accounts.len(),
        }
    }

    pub fn account_permits(&self, account_key: &str) -> usize {
        self.inner
            .accounts
            .semaphore(account_key)
            .available_permits()
    }

    fn config(&self) -> &Config {
        &self.inner.config
    }

    async fn execute(self, request: Request, request_id: Uuid, events: mpsc::Sender<Bytes>) {
        let process = self.process(request, request_id, events.clone());
        tokio::pin!(process);
        tokio::select! {
            () = events.closed() => {}
            result = &mut process => {
                if let Err(error) = result {
                    if error.code != "client_disconnected" {
                        let bytes = encode_event("error", &error.event());
                        if let Ok(bytes) = bytes {
                            let _ = events.send(bytes).await;
                        }
                    }
                }
            }
        }
    }

    async fn process(
        &self,
        request: Request,
        request_id: Uuid,
        events: mpsc::Sender<Bytes>,
    ) -> Result<(), ProxyError> {
        let prepared = {
            let _permit = self
                .inner
                .preparation
                .clone()
                .try_acquire_owned()
                .map_err(|_| ProxyError::busy())?;
            let (parts, body) = request.into_parts();
            if parts.method != axum::http::Method::POST {
                return Err(ProxyError::new("method_not_allowed", "Nur POST erlaubt."));
            }
            let content_type = parts
                .headers
                .get(CONTENT_TYPE)
                .ok_or_else(ProxyError::invalid_content_type)?
                .to_str()
                .map_err(|_| ProxyError::invalid_content_type())?;
            if !draft::is_json_content_type(content_type) {
                return Err(ProxyError::invalid_content_type());
            }
            if let Some(length) = parts.headers.get(CONTENT_LENGTH) {
                let length = length
                    .to_str()
                    .ok()
                    .and_then(|value| value.parse::<usize>().ok())
                    .ok_or_else(ProxyError::invalid_request)?;
                if length > self.config().max_browser_body_bytes {
                    return Err(ProxyError::body_too_large());
                }
            }
            let forwarded =
                forwarded_headers(&parts.headers, self.config().max_forwarded_header_bytes)?;
            let body = read_browser_body(body, self.config().max_browser_body_bytes).await?;
            let _draft = draft::decode(&body, content_type)?;
            let prepared = self
                .prepare(parts.headers, forwarded, body, request_id)
                .await?;
            prepared.validate(self.config())?
        };

        let account_semaphore = self.inner.accounts.semaphore(&prepared.0.account_key);
        let _account_permit = account_semaphore
            .try_acquire_owned()
            .map_err(|_| ProxyError::busy())?;
        let _upstream_permit = self
            .inner
            .upstream
            .clone()
            .try_acquire_owned()
            .map_err(|_| ProxyError::busy())?;
        let (prepared, timeouts) = prepared;
        events
            .send(encode_event(
                "start",
                &StartEvent {
                    model: &prepared.model_label,
                },
            )?)
            .await
            .map_err(|_| disconnected())?;
        timeout(
            timeouts.total,
            self.stream_provider(prepared, timeouts, events),
        )
        .await
        .map_err(|_| ProxyError::upstream_timeout())?
    }

    async fn prepare(
        &self,
        browser_headers: HeaderMap,
        forwarded: Vec<(&'static str, HeaderValue)>,
        body: Bytes,
        request_id: Uuid,
    ) -> Result<PreparedRequest, ProxyError> {
        let content_type = browser_headers
            .get(CONTENT_TYPE)
            .cloned()
            .ok_or_else(ProxyError::invalid_content_type)?;
        let mut request = self
            .inner
            .prepare_client
            .post(self.config().prepare_url.clone())
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, content_type)
            .header(
                SERVICE_CREDENTIAL_HEADER,
                self.config().service_credential(),
            )
            .header(REQUEST_ID_HEADER, request_id.to_string())
            .timeout(self.config().prepare_timeout)
            .body(body);
        for (name, value) in forwarded {
            if name != "content-type" {
                request = request.header(name, value);
            }
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                ProxyError::prepare_timeout()
            } else {
                ProxyError::prepare_unavailable()
            }
        })?;
        let status = response.status();
        let body = read_prepare_body(response, self.config().max_prepare_body_bytes).await?;
        if status == StatusCode::OK {
            return serde_json::from_slice(&body)
                .map_err(|_| ProxyError::invalid_prepare_response());
        }
        if let Ok(error) = serde_json::from_slice::<PrepareError>(&body) {
            if let Some(error) = ProxyError::from_prepare_code(&error.code) {
                return Err(error);
            }
        }
        Err(ProxyError::prepare_failed())
    }

    async fn stream_provider(
        &self,
        prepared: PreparedRequest,
        timeouts: EffectiveTimeouts,
        events: mpsc::Sender<Bytes>,
    ) -> Result<(), ProxyError> {
        let url = crate::prepare::validate_provider_url(
            &prepared.provider_url,
            prepared.allow_local_provider,
        )?;
        let payload =
            serde_json::to_vec(&prepared.payload()).map_err(|_| ProxyError::internal())?;
        let client = client_builder()?
            .connect_timeout(timeouts.connect)
            .build()
            .map_err(|_| ProxyError::upstream_unavailable())?;
        let mut request = client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "text/event-stream")
            .body(payload);
        if !prepared.api_key.is_empty() {
            let mut authorization = HeaderValue::from_str(&format!("Bearer {}", prepared.api_key))
                .map_err(|_| ProxyError::provider_not_configured())?;
            authorization.set_sensitive(true);
            request = request.header(AUTHORIZATION, authorization);
        }
        let response = timeout(timeouts.idle, request.send())
            .await
            .map_err(|_| ProxyError::upstream_timeout())?
            .map_err(|error| {
                if error.is_timeout() {
                    ProxyError::upstream_timeout()
                } else {
                    ProxyError::upstream_unavailable()
                }
            })?;
        if response.status() != StatusCode::OK {
            return Err(ProxyError::upstream_http(response.status().as_u16()));
        }

        let mut response = response;
        let mut parser = SseParser::new(
            self.config().max_sse_line_bytes,
            self.config().max_sse_event_bytes,
        );
        let mut assembly = StreamAssembly::new(self.config().max_text_bytes);
        let mut upstream_bytes = 0_usize;
        loop {
            if parser.completed() {
                break;
            }
            let chunk = timeout(timeouts.idle, response.chunk())
                .await
                .map_err(|_| ProxyError::upstream_timeout())?
                .map_err(|error| {
                    if error.is_timeout() {
                        ProxyError::upstream_timeout()
                    } else {
                        ProxyError::upstream_unavailable()
                    }
                })?;
            let Some(chunk) = chunk else {
                break;
            };
            upstream_bytes += chunk.len();
            if upstream_bytes > self.config().max_upstream_bytes {
                return Err(ProxyError::upstream_too_large());
            }
            parser.push(&chunk);
            while let Some(output) = parser.next_output()? {
                assembly.apply(output, &events).await?;
            }
        }
        let finish = parser.finish()?;
        if let Some(output) = finish.output {
            assembly.apply(output, &events).await?;
        }
        if !finish.completed {
            return Err(ProxyError::upstream_incomplete());
        }
        let final_text = assembly.filter.finish();
        assembly.deliver(final_text, &events).await?;
        let split = split_subject(&assembly.full, prepared.want_subject);
        events
            .send(encode_event(
                "done",
                &DoneEvent {
                    subject: split.subject,
                    body: split.body,
                    model: prepared.model_label,
                    usage: assembly.usage,
                },
            )?)
            .await
            .map_err(|_| disconnected())?;
        Ok(())
    }
}

pub fn router(service: ProxyService) -> Router {
    Router::new()
        .route("/api/ai/stream", any(stream))
        .route("/healthz", get(health))
        .with_state(service)
}

async fn health() -> &'static str {
    "ok\n"
}

async fn stream(State(service): State<ProxyService>, request: Request) -> Response {
    let request_id = Uuid::new_v4();
    let (sender, receiver) = mpsc::channel::<Bytes>(service.config().channel_capacity);
    tokio::spawn(service.execute(request, request_id, sender));
    let stream = ReceiverStream::new(receiver).map(Ok::<Bytes, Infallible>);
    let mut response = Response::new(Body::from_stream(stream));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store"),
    );
    response.headers_mut().insert(
        HeaderName::from_static("x-accel-buffering"),
        HeaderValue::from_static("no"),
    );
    if let Ok(value) = HeaderValue::from_str(&request_id.to_string()) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(REQUEST_ID_HEADER), value);
    }
    response
}

fn client_builder() -> Result<ClientBuilder, ProxyError> {
    Ok(Client::builder()
        .redirect(Policy::none())
        .min_tls_version(reqwest::tls::Version::TLS_1_2)
        .user_agent("SnappyMail-AiCopilot"))
}

fn forwarded_headers(
    headers: &HeaderMap,
    maximum_bytes: usize,
) -> Result<Vec<(&'static str, HeaderValue)>, ProxyError> {
    let mut result = Vec::with_capacity(FORWARDED_HEADERS.len());
    let mut total = 0_usize;
    for name in FORWARDED_HEADERS {
        if let Some(value) = headers.get(name) {
            total = total.saturating_add(name.len() + value.len());
            if total > maximum_bytes {
                return Err(ProxyError::invalid_request());
            }
            result.push((name, value.clone()));
        }
    }
    Ok(result)
}

async fn read_browser_body(body: Body, maximum: usize) -> Result<Bytes, ProxyError> {
    Limited::new(body, maximum)
        .collect()
        .await
        .map_err(|_| ProxyError::body_too_large())?
        .to_bytes()
        .pipe_ok()
}

trait PipeOk: Sized {
    fn pipe_ok(self) -> Result<Self, ProxyError>;
}

impl PipeOk for Bytes {
    fn pipe_ok(self) -> Result<Self, ProxyError> {
        Ok(self)
    }
}

async fn read_prepare_body(
    response: reqwest::Response,
    maximum: usize,
) -> Result<Bytes, ProxyError> {
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err(ProxyError::invalid_prepare_response());
    }
    let mut stream = response.bytes_stream();
    let mut body = BytesMut::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            if error.is_timeout() {
                ProxyError::prepare_timeout()
            } else {
                ProxyError::prepare_unavailable()
            }
        })?;
        if body.len() + chunk.len() > maximum {
            return Err(ProxyError::invalid_prepare_response());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body.freeze())
}

struct StreamAssembly {
    filter: ReasoningFilter,
    full: String,
    usage: Option<Usage>,
    maximum_text_bytes: usize,
}

impl StreamAssembly {
    fn new(maximum_text_bytes: usize) -> Self {
        Self {
            filter: ReasoningFilter::new(),
            full: String::new(),
            usage: None,
            maximum_text_bytes,
        }
    }

    async fn apply(
        &mut self,
        output: ParserOutput,
        events: &mpsc::Sender<Bytes>,
    ) -> Result<(), ProxyError> {
        if let Some(usage) = output.usage {
            self.usage = Some(usage);
        }
        if let Some(text) = output.text {
            let text = self.filter.push(&text);
            self.deliver(text, events).await?;
        }
        Ok(())
    }

    async fn deliver(
        &mut self,
        mut text: String,
        events: &mpsc::Sender<Bytes>,
    ) -> Result<(), ProxyError> {
        if text.is_empty() {
            return Ok(());
        }
        if self.full.is_empty() {
            text = php_ltrim(&text).to_owned();
            if text.is_empty() {
                return Ok(());
            }
        }
        if self.full.len() + text.len() > self.maximum_text_bytes {
            return Err(ProxyError::upstream_too_large());
        }
        self.full.push_str(&text);
        events
            .send(encode_event("delta", &DeltaEvent { text: &text })?)
            .await
            .map_err(|_| disconnected())
    }
}

#[derive(Serialize)]
struct StartEvent<'a> {
    model: &'a str,
}

#[derive(Serialize)]
struct DeltaEvent<'a> {
    text: &'a str,
}

#[derive(Serialize)]
struct DoneEvent {
    subject: String,
    body: String,
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<Usage>,
}

fn encode_event<T: Serialize>(event: &'static str, data: &T) -> Result<Bytes, ProxyError> {
    let data = serde_json::to_string(data).map_err(|_| ProxyError::internal())?;
    Ok(Bytes::from(format!("event: {event}\ndata: {data}\n\n")))
}

fn disconnected() -> ProxyError {
    ProxyError::new("client_disconnected", "")
}

#[cfg(test)]
mod tests {
    use super::{encode_event, DeltaEvent};

    #[test]
    fn downstream_delta_matches_the_legacy_golden_wire_format() {
        let event = encode_event(
            "delta",
            &DeltaEvent {
                text: "Grüße ✓\nZeile",
            },
        )
        .unwrap();
        assert_eq!(
            "event: delta\ndata: {\"text\":\"Grüße ✓\\nZeile\"}\n\n",
            std::str::from_utf8(&event).unwrap()
        );
    }
}
