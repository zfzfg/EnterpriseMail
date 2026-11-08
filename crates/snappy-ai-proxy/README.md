# snappy-ai-proxy

Isolated Axum/Tokio/reqwest-rustls sidecar for **ai-copilot draft streaming only**. It does not replace PHP authentication, session handling, feature/consent checks, IMAP context retrieval, prompt construction, or provider selection.

## Request flow

1. Nginx forwards `POST /api/ai/stream` to this service with buffering disabled.
2. Rust enforces the legacy draft JSON schema and a maximum 64 KiB browser body.
3. Rust acquires a global preparation permit and sends the original body to the loopback-only PHP prepare endpoint.
4. PHP authenticates the user and returns the typed preparation document below. Any rejection or invalid preparation response results in **zero provider calls**.
5. Only then does Rust acquire the per-account and global upstream permits. Permit acquisition is non-blocking; excess work receives `busy` instead of forming an unbounded queue. Owned permits use RAII on success, error, timeout, and cancellation.
6. Rust dispatches exactly one provider request and streams compatible SSE to the browser. There are no redirects or automatic retries.

The generated UUID is sent to PHP as `X-Request-ID` and returned downstream with the same header. Provider API keys, prepare bodies, browser cookies, CSRF tokens, and the service credential are never included in downstream SSE or application logs.

## Browser API

`POST /api/ai/stream`

- `Content-Type: application/json` with an optional UTF-8 charset parameter.
- Body fields are exactly `mode`, `tone`, `instruction`, `current`, `wantSubject`, `folder`, `uids`, `uid`, and `sent`, with the same types and limits as `DraftRequest.php`.
- Browser input cannot select an account, provider URL, model, or API key.
- All route outcomes use HTTP 200 and SSE, including validation/preparation failures, matching the legacy streaming endpoint.

Events:

```text
event: start
data: {"model":"Mistral · mistral-large-latest"}

event: delta
data: {"text":"partial text"}

event: done
data: {"subject":"Optional subject","body":"Final trimmed body","model":"Mistral · mistral-large-latest"}

event: error
data: {"error":"Localized safe message","code":"invalid_csrf"}
```

`done` may additionally contain `usage` with `prompt_tokens`, `completion_tokens`, and/or `total_tokens` when the provider supplied valid usage metadata. Usage is optional and is not requested or assumed.

Errors before permit acquisition/preparation completion emit only `error`. Provider failures after preparation normally produce `start`, zero or more `delta` events, then `error`. `done` is emitted only after `[DONE]` or a recognized completed event, final reasoning processing, and subject splitting.

The parser supports arbitrary byte splits, LF/CRLF, multiline `data:` fields, comments, unterminated final `[DONE]`, content arrays, and the legacy completion variants. It preserves Unicode and legacy initial-whitespace/final-trim behavior and incrementally removes `<think>...</think>` blocks. Malformed JSON and incomplete EOF are terminal errors.

`GET /healthz` returns only `ok\n`; it performs no PHP or provider request.

## Internal prepare RPC

Rust sends:

```text
POST http://127.0.0.1:8081/internal/ai/prepare
Content-Type: application/json
Accept: application/json
X-Snappy-Proxy-Key: <SNAPPY_AI_PROXY_SERVICE_CREDENTIAL>
X-Request-ID: <new UUID>
Cookie: <original>
X-SM-Token: <original>
Sec-Fetch-Site: <original, when present>
Sec-Fetch-Mode: <original, when present>
Sec-Fetch-Dest: <original, when present>
Origin: <original, when present>
```

The endpoint URL is configurable but restricted to HTTP(S) on `localhost` or a literal loopback IP address. The internal Nginx listener must remain loopback-only, map this exact POST to PHP with `QUERY_STRING=/AiPrepare/`, and keep the route absent from public Nginx. The service credential is separate from user authentication and is mandatory; there is no default.

The body is the original, bounded browser JSON. PHP remains responsible for every authentication and authorization decision even though Rust also performs structural validation.

### Successful response

HTTP 200 with `application/json`. Unknown fields are rejected so contract drift fails before provider dispatch.

```json
{
  "account_key": "opaque-stable-per-account-limit-key",
  "messages": [
    {"role": "user", "content": "complete prepared prompt"}
  ],
  "provider_url": "https://api.mistral.ai/v1/chat/completions",
  "api_key": "resolved-provider-secret",
  "model": "mistral-large-latest",
  "model_label": "Mistral · mistral-large-latest",
  "allow_local_provider": false,
  "want_subject": true,
  "options": {
    "temperature": 0.4,
    "max_tokens": 1500,
    "reasoning_effort": "low"
  },
  "timeouts": {
    "connect_ms": 10000,
    "idle_ms": 30000,
    "total_ms": 90000
  }
}
```

Field contract:

| Field | Rules |
| --- | --- |
| `account_key` | Required; 1–256 printable ASCII bytes. Use an opaque pseudonymous value, not an email address or account name. It is used only in the in-memory limiter and is not logged or returned. |
| `messages` | Required; 1–32 messages. Roles are `system`, `user`, or `assistant`; content is a string. This is the prepared prompt, not raw mail supplied by the browser. |
| `provider_url` | Required full chat-completions URL; maximum 4096 bytes; no userinfo or fragment. HTTPS uses normal rustls certificate/hostname verification. HTTP requires `allow_local_provider: true` and `localhost` or a literal loopback IP. |
| `api_key` | Optional; empty/omitted means no `Authorization` header. Otherwise Rust sends `Authorization: Bearer <api_key>` only to the validated provider URL. |
| `model` | Required provider model identifier. |
| `model_label` | Required safe display label used in `start` and `done`; control characters are rejected. |
| `allow_local_provider` | Optional, default `false`; enables only the loopback HTTP exception above. |
| `want_subject` | Required; controls the returned subject while an unwanted subject line is still removed from the final body, matching PHP. |
| `options` | Optional. `temperature` defaults to `0.4` and must be finite in `[0, 2]`; `max_tokens` defaults to `1500` and must be in `[1, 100000]`. Optional `reasoning_effort` accepts only `"low"`; it is omitted from the provider payload when absent. |
| `timeouts` | Optional. Millisecond values override service defaults, clamped to the service maximum and total timeout; zero is clamped to 1 ms. Idle covers response-header wait and each upstream body-chunk wait. Total covers dispatch through final downstream completion. |

Rust sends this provider payload, with no browser-controlled extras:

```json
{
  "model": "mistral-large-latest",
  "messages": [{"role": "user", "content": "complete prepared prompt"}],
  "temperature": 0.4,
  "stream": true,
  "max_tokens": 1500,
  "reasoning_effort": "low"
}
```

### Rejected response

Use a non-200 status and a small JSON body:

```json
{"code":"invalid_csrf"}
```

Only the public code is inspected; response text is never forwarded or logged. Recognized codes are `method_not_allowed`, `cross_site_request`, `invalid_csrf`, `unauthenticated`, `feature_disabled`, `consent_required`, `body_too_large`, `invalid_content_type`, `invalid_json`, `invalid_request`, `invalid_mode`, `invalid_field`, `invalid_uids`, `provider_not_configured`, `provider_unavailable`, `provider_not_eligible`, `prepare_forbidden`, `prepare_disabled`, `upstream_timeout`, and `upstream_too_large`. Unknown/malformed responses become `prepare_failed` or `invalid_prepare_response`. Rust does not expose the prepare body to the browser.

## Configuration

All settings are environment variables. Durations are milliseconds. Numeric values outside their documented bounds prevent startup.

| Variable | Default | Bounds / meaning |
| --- | --- | --- |
| `SNAPPY_AI_PROXY_SERVICE_CREDENTIAL` | **required** | 16–4096 bytes and valid as an HTTP header. Use a generated high-entropy secret, preferably at least 32 random bytes. |
| `SNAPPY_AI_PROXY_LISTEN_ADDR` | `127.0.0.1:3001` | Numeric loopback socket only; non-loopback and hostnames are rejected. |
| `SNAPPY_AI_PROXY_PREPARE_URL` | `http://127.0.0.1:8081/internal/ai/prepare` | Loopback HTTP(S), no userinfo/fragment. |
| `SNAPPY_AI_PROXY_MAX_BROWSER_BODY_BYTES` | `65536` | 1–65536 bytes. |
| `SNAPPY_AI_PROXY_MAX_PREPARE_BODY_BYTES` | `1048576` | 1–8388608 bytes, for either success or error response bodies. |
| `SNAPPY_AI_PROXY_MAX_UPSTREAM_BYTES` | `4194304` | 1–67108864 raw response bytes. |
| `SNAPPY_AI_PROXY_MAX_TEXT_BYTES` | `1048576` | 1–16777216 accumulated filtered text bytes. |
| `SNAPPY_AI_PROXY_MAX_SSE_LINE_BYTES` | `65536` | 1–1048576 bytes per upstream line. |
| `SNAPPY_AI_PROXY_MAX_SSE_EVENT_BYTES` | `262144` | 1–4194304 joined data bytes per upstream event. |
| `SNAPPY_AI_PROXY_MAX_FORWARDED_HEADER_BYTES` | `32768` | 1–65536 bytes across the allowlisted forwarded headers, including names. |
| `SNAPPY_AI_PROXY_CHANNEL_CAPACITY` | `16` | 1–1024 downstream SSE messages; full channels suspend upstream processing. |
| `SNAPPY_AI_PROXY_PREPARE_PERMITS` | `16` | 1–4096 concurrent preparation operations. |
| `SNAPPY_AI_PROXY_UPSTREAM_PERMITS` | `8` | 1–4096 concurrent provider streams globally. |
| `SNAPPY_AI_PROXY_PER_ACCOUNT_PERMITS` | `2` | 1–4096 provider streams per opaque account key. |
| `SNAPPY_AI_PROXY_PREPARE_CONNECT_TIMEOUT_MS` | `5000` | 1–300000. |
| `SNAPPY_AI_PROXY_PREPARE_TIMEOUT_MS` | `30000` | 1–300000, including the prepare response body. |
| `SNAPPY_AI_PROXY_PROVIDER_CONNECT_TIMEOUT_MS` | `10000` | 1–3600000, also clamped to the maximum below. |
| `SNAPPY_AI_PROXY_PROVIDER_IDLE_TIMEOUT_MS` | `30000` | 1–3600000, also clamped to the maximum below. |
| `SNAPPY_AI_PROXY_PROVIDER_TOTAL_TIMEOUT_MS` | `90000` | 1–3600000, also clamped to the maximum below. |
| `SNAPPY_AI_PROXY_MAX_PROVIDER_TIMEOUT_MS` | `300000` | 1–3600000 upper bound for defaults and prepare-supplied values. |

Per-account semaphores are held through weak references and pruned opportunistically, so completed accounts do not create a permanent growing registry.

## Deployment decision and lifecycle

**Phase 5 decision: GO under the plan's explicit isolation/lifecycle exception, not as a measured performance optimization.** The architectural objective is to end PHP-FPM occupancy after preparation and run long-lived provider streams in a separate unprivileged process with independent cancellation, concurrency, health, and restart handling. No measured Rust latency, throughput, memory, or concurrency advantage is claimed by this implementation or its correctness tests.

The accepted cost is an additional Rust executable and runtime lifecycle, a loopback HTTP preparation hop, service-credential bootstrap, health/capability state transitions, Supervisor policy, and a larger security/integration test matrix. The scope is deliberately limited to draft streaming, remains disabled by default, and retains PHP as the compatibility and deliberate rollback path. If this isolation/lifecycle objective is not required or the added operational complexity is not acceptable, the decision is to leave Rust disabled and retain the hardened PHP endpoint. Rollback does not replay an in-flight or failed provider request automatically.

## Release image integration

The release image contains PHP-FPM, Nginx, Supervisor, and this proxy. Rust support is **disabled by default** (`SNAPPY_AI_PROXY_ENABLED=false`); in that mode the proxy is not started, health remains 204, and the existing `POST /?/AiStream/` PHP endpoint remains the client path.

When explicitly enabled, the entrypoint accepts a 16–256-byte `SNAPPY_AI_PROXY_SERVICE_CREDENTIAL` or generates 64 random hex characters, supplies it independently to PHP and Rust, and keeps credential setup outside shell xtrace. The credential is mandatory for every internal prepare request even on loopback; missing or incorrect credentials are rejected before user preparation or provider dispatch. There is no shared default credential.

Nginx exposes exact `POST /api/ai/stream` through loopback Rust at `127.0.0.1:3001`. Rust prepares through exact `POST /internal/ai/prepare` on loopback Nginx at `127.0.0.1:8081`, which maps to PHP with `QUERY_STRING=/AiPrepare/`; that route is absent publicly. PHP-FPM also listens only on `127.0.0.1:9000`.

FPM uses `clear_env = yes` with an explicit allowlist for `SNAPPY_AI_PROXY_ENABLED`, `SNAPPY_AI_PROXY_SERVICE_CREDENTIAL`, `MISTRAL_API_KEY`, and `LLMSTER_API_KEY`. Unrelated process environment secrets are not inherited by PHP workers. Startup-only settings such as upload size and cookie flags are rendered by the entrypoint; Rust receives its own `SNAPPY_AI_PROXY_*` configuration directly from Supervisor rather than through FPM.

Authenticated, non-admin AppData advertises the capability only when Rust is enabled, the provider is configured and eligible, and its health probe succeeds:

```php
$aConfig['rustStream'] = ['route' => 'api/ai/stream'];
```

The relative route preserves an external URL prefix through the client's normal `root()` handling. Admin, guest, default-disabled, unhealthy, and ineligible configurations expose no Rust route or secret. The existing PHP streaming route remains intact and is used when this capability is absent.

PHP admits HTTPS provider profiles. Plain HTTP is eligible only for the `llmster` profile with a `localhost`, IPv4 127/8, or `::1` provider host. Other HTTP providers—including private-LAN addresses and `host.docker.internal`—stay on legacy PHP; this is not a general private-network HTTP exception.

The release health endpoint remains 204 in PHP-only mode. Explicitly enabled but unavailable Rust produces 503; healthy Rust produces 204. Health checks make no provider or prepare request. Rust runs as unprivileged `snappy-ai-proxy`, without mail-data access, with core dumps disabled. Supervisor restarts it only after unexpected exits. Expected Rust stops do not terminate the container; FATAL Rust startup, Nginx exits, and PHP exits do.

### Client address and trusted reverse-proxy topology

Public PHP FastCGI requests set `REMOTE_ADDR` from Nginx `$remote_addr`, the direct socket peer. Arbitrary inbound `X-Real-IP` and `X-Forwarded-For` values are not trusted, so a direct client cannot spoof its PHP address with those headers. The private prepare listener independently fixes `REMOTE_ADDR` to `127.0.0.1` and still requires the service credential and user security context.

When a trusted reverse proxy fronts the container, PHP sees that proxy's immediate peer address; the release configuration does not implicitly restore the original client address. If original-client logging or policy is required, configure Nginx real-IP handling only for explicit trusted proxy addresses with `set_real_ip_from` and a chosen `real_ip_header`, prevent untrusted clients from bypassing that proxy, and retest the complete direct and prefixed topologies. Never restore client addresses by passing `$http_x_real_ip` globally to PHP.

## Security and privacy boundaries

- The service binds only to loopback. Nginx remains the public boundary and must apply its normal request/security policy.
- Remote providers use HTTPS with rustls, verified certificates/hostnames, and a minimum TLS version of 1.2. No insecure certificate option exists. The lockfile and tests do not prove provider support for a particular TLS version.
- Redirects and automatic retries are disabled. A non-200 response, timeout, malformed stream, or disconnect never causes another provider dispatch.
- Prompt, mail, response, credential, and internal-RPC content is not intentionally logged or persisted by this crate. Release runtime users and core limits are configured as described above; deployments must still restrict swap and host diagnostics and keep internal bodies/headers out of Nginx access logs.
- HTTPS URL validation alone is not a network egress firewall. Deployments with untrusted provider-profile administration should additionally enforce egress/DNS address-range policy at the container/network boundary.
- Provider ZDR is a provider account/API/contract property. This sidecar cannot prove or enforce it.

## Build and verification

The pinned toolchain is Rust `1.93.0` in both `rust-toolchain.toml` and the release Docker builder; `Cargo.lock` is committed. Standard verification:

```sh
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --all-targets --locked
cargo build --release --locked
```

The lockfile resolves exact crates.io versions with registry checksums and no git-sourced dependencies. Release and verification builds use `--locked`. The supply-chain gate additionally runs `cargo-audit` 0.22.2 with warnings denied and `cargo-deny` 0.20.2 against `deny.toml`: vulnerabilities, unmaintained or unsound crates, yanked versions, unapproved licenses, unknown sources, and wildcard dependencies fail; duplicate versions are reported as warnings. License checking includes development and build dependencies. This does not pin every container base image by digest.

From the repository root, run the same x86_64 Linux check locally with `bash scripts/ci/rust-supply-chain.sh`, or use the digest-pinned Rust container with `bash scripts/ci/rust-supply-chain-docker.sh`. The scripts download only the two official musl release archives and verify their committed SHA-256 hashes. Reports are written to `build/local/release/rust-supply-chain/`: tool/input provenance, RustSec audit JSON, per-crate license JSON, and the complete policy result. CI uploads the same reports as `rust-supply-chain-reports`, including on a failed audit. Advisory results intentionally change as the RustSec database is updated; tool archives and application dependency versions do not.

Unsafe Rust is forbidden and `clippy::all` is denied. Tests use only in-process/loopback mocks and never contact a live provider. Coverage includes arbitrary parser splits, CRLF, malformed JSON/shapes, incomplete EOF, reasoning tags, content arrays, subject/Unicode/whitespace compatibility, authorization failures with zero provider calls, body limits, redirect rejection, idle timeout, slow consumers, disconnect cancellation, global/per-account saturation, and permit return to baseline.

With Docker on an MSYS shell, prefix container commands with `MSYS_NO_PATHCONV=1` and mount this crate at `/work`. The supply-chain Docker wrapper handles this path conversion itself.

The isolated release fixture under `.docker/release/test/phase5/` builds the real image and exercises PHP, Nginx, Rust, and Supervisor against an isolated mock provider, including an external-prefix proxy. Its compose project, ports, volumes, and mock listener are separate from existing development environments. Run `python .docker/release/test/phase5/integration.py` from the repository root; do not add `-v` when stopping the fixture, so its volumes are preserved.

Verified for this integration: Rust formatting, Clippy with warnings denied, all 19 unit and 12 integration tests, and the locked release build passed with Rust 1.93.0. PHP lint and all 359 deterministic plugin assertions passed on PHP 8.2 and 8.5. The real isolated release suite passed 134 integration assertions, including streaming parity, external-prefix routing, client-address spoofing rejection, FPM environment isolation, missing/incorrect service credentials, cancellation, single-dispatch failure behavior, capability health transitions, deliberate rollback, supervision, privilege boundaries, secret/log checks, and image listener metadata. No test contacted a live provider.

## Deliberate limitations

- Only draft streaming is implemented. Synchronous completions, summaries, chat, quick replies, search, triage, alerts, caching, and tools remain in PHP.
- No automatic fallback to legacy PHP occurs after a possible provider dispatch; a deliberate new user action is required.
- No heartbeats are emitted; configured upstream idle timeouts apply.
- No live-provider or multi-architecture verification is claimed. Broader release-image hardening remains a release-pipeline responsibility.
