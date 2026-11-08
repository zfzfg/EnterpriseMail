# Performance, Resource Efficiency, and Optional Rust Integration Plan

**Status:** Revised implementation proposal  
**Scope:** This SnappyMail fork, its TypeScript client, PHP backend, AI Copilot plugin, Docker image, maintenance jobs, CI, and release process  
**Supersedes:** `PLAN-performance-und-rust.md`

## 1. Executive summary

The original plan identifies two genuine performance concerns:

1. PHP-FPM worker concurrency is bounded, and every active AI draft stream currently occupies one PHP worker for the duration of preparation and upstream streaming.
2. The production image and frontend delivery path have optimization opportunities.

However, several original assumptions must not be implemented as written:

- PHP-FPM already uses `pm = ondemand`; reducing `pm.max_children` primarily caps concurrency and peak memory. It does not guarantee a large idle-memory reduction.
- No reproducible runtime benchmark supports the stated RAM, image-size, or percentage-saving targets.
- `lessphp` is still part of the theme/plugin LESS compatibility path.
- Imagick is currently the preferred server-side attachment-thumbnail backend in the release image.
- The release Dockerfile does not currently install OPcache, so adding an INI file alone would not enable it.
- The existing SnappyMail PHP code already contains storage garbage collection. The more immediate problem is that this TypeScript client does not invoke `AppDelayStart`, and the existing scheduler has correctness weaknesses.
- Rust cannot enforce a provider's contractual Zero Data Retention policy merely by sending headers or using TLS.
- The existing AI route is `/?/AiStream/`, where `AiStream` is in the query string. It cannot be transparently replaced by a normal Nginx path location without an explicit routing and authentication design.

The recommended strategy is therefore:

1. Establish a reproducible baseline and automated compatibility gates.
2. Make isolated, measurable Docker, PHP, asset-delivery, and maintenance improvements.
3. Harden and contract-test the existing PHP AI streaming endpoint.
4. Build a Rust streaming sidecar only if measurements demonstrate a concurrency, isolation, or latency benefit that justifies the additional operational complexity.
5. Preserve the PHP implementation as a compatibility and rollback path, including for non-Docker installations.

No absolute memory-saving promise should be made until the same workloads have been measured on the same host, image architecture, dataset, and container limits.

## 2. Evidence and current state

### 2.1 Evidence used for this revision

This revision is based on repository inspection, an offline esbuild size comparison, and a successful TypeScript typecheck. No live Mistral requests, Docker load tests, or production memory captures were performed during the analysis. Consequently:

- Statements about code paths and configuration are observed repository facts.
- Bundle-size comparisons are offline build measurements, not measured browser transfer sizes.
- Runtime memory, throughput, latency, and concurrency figures remain hypotheses until Phase 0 is complete.

### 2.2 Relevant architecture

| Area | Current implementation |
| --- | --- |
| Mailbox frontend | TypeScript under `ui/src/`; no UI framework; separate mailbox and admin esbuild bundles |
| Backend | SnappyMail/RainLoop PHP API; IMAP/SMTP remains in PHP |
| Production container | `php:8.5-fpm-alpine` runtime with Nginx, PHP-FPM, and Supervisord |
| Minimum PHP version | PHP 8.2 according to the repository documentation and integrity checks |
| AI draft streaming | PHP plugin endpoint `POST /?/AiStream/`, using same-origin cookies and `X-SM-Token` |
| Other AI operations | Synchronous plugin JSON calls through `/?/Json/`; these are not covered by the current SSE endpoint |
| Storage | File-based temporary attachments, custom session/token files, file cache, and SQLite address books |
| Frontend artifacts | Committed CSS, JavaScript, icons, and fonts under `snappymail/v/0.0.0/static/` |
| Rust | No Cargo project or Rust runtime component currently exists |

### 2.3 Important corrections to the original proposal

| Original proposal or assumption | Revised decision |
| --- | --- |
| Set FPM to `ondemand` and immediately reduce 30 children to 8 | `ondemand`, a 10-second idle timeout, and 30 maximum children are already configured. Benchmark 8, 16, and 30 only after measuring worker memory, queueing, and application latency. |
| Change `pm.max_requests` from 500 to 250 to eliminate leaks | Retain 500 initially. Recycling masks some leaks but does not fix them and increases process churn. Change only with memory-soak evidence. |
| Add a 32 MB OPcache configuration | First install/enable OPcache in the release image. Size memory and file capacity from `opcache_get_status()` under the complete production plugin set. OPcache may increase shared memory while reducing CPU and latency. |
| Always disable OPcache timestamp validation | Safe only for immutable production deployments with container replacement or explicit invalidation on every code/plugin change. Development bind mounts need an override. |
| Delete `lessphp` for a meaningful resource saving | Defer. It is lazy-loaded but still used when custom themes or plugins provide LESS. Its disk footprint is too small to justify a compatibility break as a performance measure. |
| Remove Imagick because thumbnails are browser-side | Do not remove unconditionally. The UI requests `RawViewThumbnail`; the server generates thumbnails and currently prefers Imagick over GD in the release image. Evaluate a GD-only image separately with a full format/security matrix. |
| Rust uses a fixed small amount of RAM regardless of concurrency | Remove fixed guarantees. Measure TLS sessions, buffers, queued requests, response accumulation, runtime overhead, and slow-client behavior. |
| Rust enforces Mistral ZDR | Separate local no-content-logging/no-persistence controls from provider retention. ZDR must be verified as a provider account, API, and contractual property. |
| Route `/api/ai/*` transparently without changing the client | Add an explicit new path and extend the existing `streamEvents()` helper. Retain `/?/AiStream/` for old clients and rollback. |
| Add a Rust storage cleaner that deletes old files and SQLite sidecars | Do not. Repair and schedule the existing PHP maintenance service. Never directly delete SQLite WAL, SHM, or rollback-journal files. |
| Two-hour attachment deletion is safe | Retain the current 48-hour attachment retention initially. Active drafts and attachment reads require leases or mtime semantics before a shorter TTL can be considered. |

## 3. Goals, non-goals, and success criteria

### 3.1 Goals

- Reduce memory high-water marks and image size without shifting the cost into queueing, timeouts, errors, or unsupported configurations.
- Prevent long-lived AI streams from degrading unrelated mailbox requests.
- Preserve the existing PHP JSON API, user-visible behavior, authentication, authorization, and plugin capability gates.
- Make local AI privacy controls explicit and auditable without claiming control over provider-side retention.
- Restore reliable cleanup of abandoned temporary files using the existing application ownership model.
- Improve frontend transfer size and runtime responsiveness using measured, incremental changes.
- Make builds, releases, upgrades, multi-architecture images, and rollback reproducible.
- Keep a fully supported PHP-only deployment mode.

### 3.2 Non-goals

- Rewriting IMAP, SMTP, MIME, authentication, contacts, cryptography, or the complete SnappyMail backend in Rust.
- Migrating every AI operation to Rust in the first sidecar increment.
- Introducing a second frontend HTTP client or bypassing existing SnappyMail capability checks.
- Treating Rust, memory safety, TLS, or a sidecar as proof of Zero Data Retention.
- Deleting arbitrary files under the private-data root or `/tmp` based only on age.
- Enabling SQLite WAL, changing auto-vacuum behavior, or running routine aggressive database maintenance as part of file cleanup.
- Large-scale frontend code splitting, virtualization, or architectural rewrites before browser measurements justify them.
- Guaranteeing universal support for every optional PHP extension in an aggressively slimmed image.

### 3.3 Acceptance criteria

Every performance change must satisfy all of the following:

1. **Correctness:** Existing mailbox, authentication, settings, contacts, cryptography, attachment, and plugin-disabled flows pass their relevant tests.
2. **Security:** Unauthorized or feature-disabled AI requests result in zero upstream provider calls. No secrets, message bodies, prompts, responses, cookies, or CSRF tokens appear in logs or metrics.
3. **Latency:** No statistically stable regression greater than 10% in p95 latency for the core mailbox workload unless explicitly reviewed and accepted. First measure run-to-run noise so this threshold is meaningful.
4. **Capacity:** FPM queueing, `max children reached` events, timeouts, 5xx responses, and OOM kills do not worsen beyond agreed service objectives.
5. **Memory:** Report cgroup memory current/peak and per-process PSS/RSS. Do not claim savings from guessed worker averages or by summing shared RSS as private memory.
6. **Compatibility:** PHP 8.2 and the production PHP version are covered, and all published image architectures pass equivalent smoke tests or are explicitly removed from publication.
7. **Rollback:** The previous image digest and PHP AI streaming route restore service without data migration or loss.
8. **Reproducibility:** CI proves that committed static assets match the TypeScript sources and that release artifacts come from pinned, reviewed inputs.

The original absolute RAM and image-size numbers may be retained only as uncommitted hypotheses in benchmark reports, not as release promises.

## 4. Execution order and decision gates

| Phase | Deliverable | Depends on | Decision gate |
| --- | --- | --- | --- |
| 0. Baseline and contract freeze | Reproducible workloads, metrics, fixtures, existing AI/storage contract tests | None | Baseline is repeatable; critical flows have regression coverage |
| 1. Build and runtime fundamentals | Verified OPcache, build-context cleanup, reproducible inputs, asset minification, health checks | Phase 0 | Each isolated image passes correctness and benchmark comparison |
| 2. Evidence-based FPM and dependency sizing | Tuned FPM profile and independently evaluated extension set | Phase 1 | Memory savings do not violate latency, compatibility, or capacity criteria |
| 3. Reliable PHP maintenance | Repaired maintenance scheduler plus optional one-shot CLI scheduler | Phase 0 | Cleanup is reliable, retryable, scoped, and safe under concurrency |
| 4. Existing AI path hardening | Bounded requests, robust SSE client/server behavior, cancellation and privacy tests | Phase 0 | Legacy PHP endpoint passes the complete contract suite |
| 5. Optional Rust AI streaming sidecar | Prepare-in-PHP/stream-in-Rust implementation behind a deployment gate | Phases 1, 2, and 4 for a performance-driven decision; Phases 1 and 4 plus an explicit isolation requirement for an isolation-driven exception | Performance-driven adoption requires FPM sizing and combined-load evidence; isolation-driven adoption instead requires a documented threat/isolation objective and a comparative complexity/security review |
| 6. Measured frontend runtime work | Poll/startup/cache/list/image improvements selected from browser profiles | Phase 0; can run independently after baselines | No interaction, focus, accessibility, or memory regressions |
| 7. Release and rollout completion | CI/release corrections, canary procedure, rollback drill, documentation | Relevant preceding phases | Fresh install, upgrade, rollback, and PHP-only mode verified |

Phases 3 and 6 can proceed independently once baseline fixtures exist. Do not combine unrelated dependency removals, FPM tuning, and Rust rollout in one performance comparison; otherwise regressions cannot be attributed.

## 5. Phase 0 — Establish the baseline and freeze behavior

### 5.1 Define reference environments

Create at least one documented reference environment and keep it stable across comparisons:

- Host CPU model, physical core count, RAM, kernel, Docker version, cgroup version, and architecture.
- Container CPU and memory limits.
- Exact image ID/digest, base-image digest, PHP version, Nginx version, extension versions, and enabled plugin list.
- Mailbox sizes, folder sizes, message-size distribution, attachment formats, and authentication/database configuration.
- Mock IMAP/SMTP and mock LLM services with deterministic responses and controllable latency.
- Browser version and desktop/mobile viewport for frontend measurements.

Use immutable fixtures. Never use a live model for routine load or correctness tests.

### 5.2 Capture server and image metrics

For each candidate build, record:

- Uncompressed image size, compressed registry artifact size where available, and major layer/package contributions.
- Fresh idle memory after readiness and after idle FPM workers have drained.
- Warm idle memory after a representative mailbox session.
- cgroup `memory.current`, `memory.peak`, CPU usage, throttling, OOM events, and file-descriptor counts.
- Per-process PSS and RSS where practical, distinguishing private memory from shared OPcache/libraries.
- FPM active/idle workers, queue depth, listen-queue waits, max-children events, request counts, and worker restarts through the private `/status` endpoint.
- Throughput, p50/p95/p99 latency, error rate, and timeout count.

Implement FPM status access through a local FastCGI exporter or a separate loopback-only Nginx/FastCGI route; `pm.status_path = /status` alone does not create a usable HTTP endpoint in the current public Nginx configuration. Test that public `/status` requests remain denied and that neither FPM nor its metrics listener is published.

`docker stats` is a useful supplemental view, not the sole benchmark instrument.

### 5.3 Define repeatable workloads

Run at least five repetitions after a documented warm-up. Report median, p95, variance, and environment metadata.

| Workload | Required scenarios |
| --- | --- |
| Anonymous application boot | Static assets, application data, plugin enabled/disabled, cold/warm cache |
| Authenticated mailbox | Login, folders, list, message read, flags, search, contacts, settings, logout/reauthentication |
| Attachments and images | Upload, draft autosave, send, download, thumbnail, unsupported/malformed image, large image |
| Backend concurrency | 1, 10, and 25 concurrent users with representative 20/100-row message pages |
| Large mailboxes | Deterministic 10,000- and 100,000-message fixtures where supported by the test environment |
| AI streaming | 1, 5, 10, 30, and optionally 100 streams using controlled delays and response sizes |
| Combined load | Mailbox traffic while streams are active; measure mailbox latency separately |
| Cancellation | Stop button, browser disconnect, slow downstream reader, upstream disconnect |
| Soak | 30–60 minutes of polling, navigation, streaming, cleanup, and repeated login/logout |
| Upgrade/rollback | Fresh install, previous-version upgrade, rollback, persisted-volume integrity |

### 5.4 Freeze the existing AI contract before refactoring

The current browser draft request contains:

- `mode`: `new`, `reply`, `rewrite`, or `proofread`
- `tone`
- `instruction`
- `current`
- `wantSubject`
- `folder`
- `uids`
- `sent`

The existing SSE event shapes are:

- `start`: `{model}`
- `delta`: `{text}`
- `done`: `{subject, body, model}`
- `error`: `{error}`

Add golden and streaming parser tests around the current behavior, including the fact that many existing failures are returned as HTTP 200 followed by an `error` event. A new endpoint may use clearer HTTP status codes before SSE headers are sent, but the legacy endpoint must not silently change during the migration.

### 5.5 Add minimum CI gates before optimization

- Run `npm ci --prefix ui`, the UI typecheck, and the UI build on every relevant pull request.
- Fail CI if generated icons or committed static artifacts differ after a clean build.
- Pin and document the Node.js version.
- Run PHP syntax checks and classify the existing standalone scripts under `test/` into unit and integration groups.
- Add PHP 8.2 and production-PHP coverage.
- Run Docker smoke tests against actual HTTP behavior, not only open ports.
- Preserve benchmark output, bundle reports, and image metadata as CI artifacts.

## 6. Phase 1 — Low-risk build and runtime fundamentals

### 6.1 Make Docker builds deliberate and reproducible

1. Expand `.dockerignore` to exclude `ui/node_modules`, local runtime data, secrets, editor files, and unrelated build outputs. Prefer an explicit build-context allowlist if practical.
2. Pin base images by digest for comparable builds, with an intentional update process for security patches.
3. Pin PECL extension versions or another reproducible source. Record extension versions in image metadata or a build report.
4. Replace silent hotfix patterns such as `sed ... || true` with deterministic patches that fail when the expected source does not match.
5. Verify the final image rather than inferring its contents from the builder stage.
6. Add container health/readiness checks that do not require a live AI provider or expose private metrics publicly.

**Exit criteria:** Two clean builds from the same reviewed inputs produce equivalent application artifacts, and the build context no longer contains local dependencies or runtime data.

### 6.2 Install and size OPcache correctly

The release image must explicitly install/enable OPcache before configuration is added.

Initial safe rollout:

- Enable OPcache for FPM, not CLI unless a CLI workload benefits.
- Keep timestamp validation enabled initially.
- Keep comment saving enabled initially for third-party plugin compatibility.
- Start with a documented candidate memory/file capacity, then inspect actual cached-script count, free/wasted memory, restarts, and cache misses under the full production plugin set.
- Size capacity from observed usage plus headroom; do not assume 32 MB or 4,000 files is universally sufficient.
- Compare CPU, latency, shared memory, and per-worker memory against the baseline.

For immutable production images only:

- Test `validate_timestamps=0` as a separate change.
- Require full container replacement or an explicit OPcache invalidation/FPM reload on every application, plugin, and configuration change.
- Override this setting in development because the AI development Compose setup bind-mounts application source.
- Do not use this mode with an in-place updater unless restart/invalidation semantics are made reliable.

Treat `opcache.save_comments=0` as an optional later micro-optimization only after plugin compatibility tests prove that doc-comment reflection is unused.

**Exit criteria:** OPcache is verified in the running image, has no restart/capacity thrashing, and provides a measured benefit without stale-code behavior.

### 6.3 Minify and measure frontend artifacts

Current offline analysis found:

| Artifact | Current raw | Minified raw | Current gzip-9 | Minified gzip-9 |
| --- | ---: | ---: | ---: | ---: |
| `app.js` | 622,121 bytes | 458,697 bytes | 135,347 bytes | 113,382 bytes |
| `admin.js` | 131,805 bytes | 116,083 bytes | 19,111 bytes | 17,094 bytes |

These values justify testing esbuild `--minify` as an isolated low-risk change. They do not describe current Nginx transfer sizes, which use dynamic gzip at a different compression level.

Implementation:

1. Add minification to both JavaScript entry builds.
2. Preserve source maps according to an explicit debugging/release policy; do not publish maps accidentally if they are not intended for users.
3. Record raw and compressed sizes for both entries and CSS on every pull request.
4. Start with a bundle-budget gate that fails unexplained growth above approximately 2%, then tune the threshold to normal repository churn.
5. Generate esbuild metafiles and review composition before attempting code splitting.
6. Refactor generated icon exports or per-entry icon sets so unused icon bodies can be tree-shaken. The current generated icon object contributes substantially to both bundles.
7. Defer lazy loading of composer, contacts, settings, and Sieve until cold-start profiles identify a worthwhile split.

### 6.4 Review static delivery without stale releases

- Preserve versioned release URLs based on `APP_VERSION` for cache busting.
- Test cold cache, warm cache, 304 responses, content negotiation, `Vary`, upgrades, and rollback.
- Compare dynamic gzip with build-time gzip/Brotli by measuring image growth, server CPU, and actual transferred bytes.
- Add precompressed serving only if the complete release chain generates and deploys the files; the current `--skip-gulp` path skips the legacy precompression block.
- Keep development `0.0.0` asset URLs from becoming permanently cached across rebuilds.
- Do not mix assets from different application versions during upgrade or rollback.

## 7. Phase 2 — Evidence-based FPM and dependency sizing

### 7.1 Derive FPM limits from measurements

Retain the current baseline initially:

- `pm = ondemand`
- `pm.max_children = 30`
- `pm.process_idle_timeout = 10s`
- `pm.max_requests = 500`

Test candidate `pm.max_children` values such as 8, 16, and 30 under identical mail-only, AI-only, and combined workloads.

A sizing model should reserve memory for:

- FPM master and baseline workers
- Measured per-worker private high-water memory, including realistic plugins and large requests
- OPcache and APCu shared segments
- Nginx, Supervisord, and optional Rust process
- Native image/crypto/library allocations
- Kernel/page-cache effects and operational headroom

The per-request PHP `memory_limit` is a ceiling, not observed usage. Native library allocations are not reliably bounded by it. A smaller child limit is valid only if the resulting concurrency still meets the service objective.

Measure queueing and failures explicitly. A configuration that reaches a RAM target by leaving requests queued is not an optimization.

Only test a lower `pm.max_requests` after a soak demonstrates recurring worker growth. Investigate and fix actual leaks where possible; do not describe recycling as leak elimination.

### 7.2 Evaluate extensions independently

Build one candidate image per removal or coherent removal group. Run the relevant feature tests and compare final image layers and runtime memory.

| Candidate | Required decision process |
| --- | --- |
| `lessphp` | Inventory custom themes and third-party plugins. Migrate supported LESS assets to CSS and provide a compatibility notice before removal. Expect cleanup benefits, not material RAM savings. |
| Imagick | Compare against GD-only with JPEG, PNG, GIF, WebP, EXIF orientation, transparency, malformed files, decompression bombs, AVIF/BMP/SVG and other currently accepted image types. Add graceful fallback for unsupported types before rollout. |
| ImageMagick retained | Inspect and harden decoder/resource policies, container memory limits, input-size limits, and error handling. Test memory peaks and CPU. |
| PECL GnuPG/gpgme | The core PECL backend is hard-disabled while CLI GnuPG remains available. Verify all plugins and cryptographic flows before removing the extension; retain the required CLI binary. |
| Tidy | Verify core and third-party plugin usage. The inspected core repair call is commented, but external compatibility is not thereby proven. |
| UUID extension | A pure-PHP fallback exists. Compare behavior and performance before removal. |
| PDO drivers, LDAP, Redis, APCu, Zip | These serve optional deployments/plugins. Do not call them universally unnecessary. |
| Full versus slim image | Consider documented variants only if operational demand justifies maintaining and testing multiple support matrices. |

Do not trade silent feature regressions for a smaller image. Publish supported-feature differences explicitly if variants are introduced.

### 7.3 Correct proxy and network trust assumptions

Before using client IP addresses for audit or rate-limit decisions:

- Restrict which proxies may supply forwarding headers.
- Review the current Nginx assignment of `REMOTE_ADDR` from `X-Real-IP`; a direct client must not be able to spoof a trusted address.
- Keep FPM status, FPM port 9000, Rust port 3001, and metrics endpoints on private/loopback interfaces only.
- Document the expected proxy topology and test direct-container and reverse-proxy deployments separately.

## 8. Phase 3 — Restore reliable maintenance in PHP

### 8.1 Use actual storage paths and retention rules

The normal private-data root is host-dependent and Docker commonly places it below `/var/lib/snappymail/`. Do not hardcode a single `_default_` layout.

Relevant storage classes include:

- Temporary attachment/file storage below account-specific `.files/` directories.
- SnappyMail custom session files below `.sessions/`.
- “Sign me” tokens below `.sign_me/`.
- The configured file-cache root, if the file cache driver is active.
- Request-scoped `/tmp/snappymail/` files owned by PHP temporary-file objects.

Initial retention should preserve current behavior:

- `.files/` and file cache: approximately 48 hours.
- Custom sessions: approximately 3 hours.
- Sign-me tokens: approximately 30 days.

A generic two-hour attachment TTL is not safe without active-draft leases or access-based mtime refresh.

### 8.2 Repair the existing scheduler

`DoAppDelayStart()` already throttles cache and storage maintenance, but this client does not call `AppDelayStart`. In addition:

- Scheduler timestamps are advanced before successful maintenance.
- Cache and file maintenance are coupled through `else if`, so one can be skipped when both are due.
- Recursive deletion lacks comprehensive active-file and symlink safeguards.

Implementation tasks:

1. Invoke `AppDelayStart` nonblockingly after application startup, without delaying first usable mailbox rendering.
2. Refactor maintenance into a shared PHP service used by both the web-triggered path and a future CLI command.
3. Give cache, session/token, and temporary-file jobs independent schedules and completion records.
4. Write completion timestamps only after successful completion; failed jobs must be retried with bounded backoff.
5. Add a nonblocking inter-process lock to prevent overlapping maintenance runs.
6. Run maintenance as the same unprivileged UID/GID that owns application data, normally `www-data` in the container.
7. Record duration, scanned/deleted counts, bytes reclaimed, lock skips, and failures without logging user content or sensitive paths.

### 8.3 Add unattended execution only where needed

If cleanup must run while no users are active:

- Expose a one-shot PHP CLI maintenance command using the shared service.
- Schedule it through host cron or a deliberately supervised scheduler.
- Avoid a permanent cleaner daemon when a periodic one-shot process is sufficient.
- Ensure the job sees the persistent data volume and uses the correct UID/GID.
- Prevent overlapping web and CLI maintenance through the shared lock.

A separate Rust cleaner adds deployment and safety complexity without a demonstrated benefit. Reconsider one only after profiling shows that the PHP maintenance workload itself violates a measured resource objective.

### 8.4 File-deletion safety invariants

Every cleaner implementation must:

1. Allowlist exact storage classes; never recursively age-delete all of `APP_PRIVATE_DATA`, `storage/`, or `/tmp`.
2. Resolve custom data roots, multidomain names, additional accounts, custom cache paths, and non-file cache drivers.
3. Use `lstat`-style semantics, reject symlinks and non-regular files, and never follow directory symlinks.
4. Recheck file type and age immediately before unlinking.
5. Remove only empty directories.
6. Avoid `/tmp/snappymail/` entries that may be live GnuPG compatibility symlinks or active request files.
7. Treat cleaner-only locks as overlap prevention, not proof that a file is inactive. Shortening TTL requires participating reader/writer locks or explicit leases.
8. Leave PHP upload temporary files and Nginx request temporary paths to their owning runtime.

### 8.5 Leave SQLite state files untouched

Stock address-book PDO setup does not enable WAL, and the schema does not enable incremental auto-vacuum. Therefore `.wal`/`.shm` cleanup and routine `incremental_vacuum` are not justified by the current implementation.

Never directly unlink:

- `-wal`
- `-shm`
- rollback journals
- any other SQLite sidecar as though it were temporary junk

If optional database maintenance is later justified by measured freelist/WAL growth:

- Open only known address-book DSNs through SQLite/PDO.
- Inspect `journal_mode`, `auto_vacuum`, and `freelist_count` first.
- Use a short busy timeout and skip on contention.
- Prefer passive checkpointing where appropriate.
- Do not enable WAL, change auto-vacuum, or run full `VACUUM` as part of generic cleanup.
- Verify SQLite version and concurrency fixes in the final image.
- Test contact CRUD and `PRAGMA integrity_check` before and after maintenance, including an explicitly created WAL fixture with active readers/writers.

**Phase exit criteria:** Abandoned files are reclaimed without active-draft loss; failed jobs retry; concurrent runs are safe; no database sidecar is directly deleted.

## 9. Phase 4 — Harden the existing PHP AI streaming path

This phase is required whether or not Rust is introduced. It creates the reference behavior and closes existing correctness/privacy gaps.

### 9.1 Preserve authorization and feature gates

The current PHP path performs more than streaming:

- POST and CSRF validation.
- Account resolution from cookies and server-side session state.
- Admin, account, and per-user assistant feature checks.
- IMAP thread and related-sent-message retrieval.
- Draft prompt construction and truncation.
- Provider profile, model, timeout, and secret resolution.

A CSRF token alone is not authentication. Any replacement must delegate the complete decision to trusted PHP code or reproduce it through a separately reviewed security design.

The UI acknowledgement for sending content to an AI provider is currently not a sufficient server-side authorization check. Add a server-side requirement consistent with the product consent model, and test direct API calls that bypass the browser.

### 9.2 Bound and validate requests

- Add a small AI-specific request-body limit; approximately 64 KiB is a starting candidate for the current browser-supplied fields, subject to compatibility testing.
- Validate content type, JSON structure, field types, enum values, array lengths, UID formats, and maximum field lengths.
- Keep fetched mail context server-side; do not let the browser submit an arbitrary provider URL, model, API key, or account identity.
- Preserve instruction and current-draft truncation in the shared prompt builder.
- Return structured, non-sensitive error codes while keeping user-facing messages localized through existing UI mechanisms.

### 9.3 Fix SSE lifecycle and parser defects

Server and client work includes:

- Parse upstream SSE across arbitrary byte, line, JSON, CRLF/LF, and reasoning-tag boundaries.
- Do not silently ignore malformed upstream JSON without a controlled error/diagnostic path.
- Treat EOF without `done` as an error in the browser, not successful completion.
- Handle a final unterminated downstream block if it is considered valid; otherwise require and test terminators consistently.
- Cancel/release the browser reader in `finally` paths when parsing or callbacks throw.
- Propagate downstream disconnects to upstream cancellation wherever the PHP runtime permits.
- Emit `done` only after a valid completed upstream response and final processing.
- Preserve Unicode, content-array handling, subject splitting, initial whitespace behavior, and final trimming.
- Add heartbeats only if proxy/idle-timeout measurements show a need; document their event/comment format and client handling.

### 9.4 Define retries and timeouts precisely

- Preserve configurable provider profiles, including remote Mistral and explicitly configured local llmster/LM Studio endpoints.
- Distinguish connect timeout, upstream idle timeout, total request timeout, and PHP preparation/IMAP timeout.
- Automatically retry only when it is established that no upstream request was dispatched, or when the provider offers effective idempotency for the retried operation. A connection failure or timeout can be ambiguous if request bytes may already have been transmitted.
- Never automatically retry after upstream dispatch merely because no delta reached the browser, and never repeat a partially streamed response. A provider 429/502/503 response already proves that a request reached the provider; repeating it can duplicate generation and cost unless idempotency is guaranteed.
- Honor provider rate-limit guidance where available, with bounded delay and jitter, subject to the same dispatch/idempotency rule.
- Remove blocking sleep behavior from any future asynchronous implementation.
- Test 401, 403, 413, 429, 500, 502, 503, connect failure, idle stall, total timeout, and failure before/after upstream dispatch and before/after the first delta. Assert that ambiguous post-dispatch failures cause no automatic duplicate request.

### 9.5 Build an automated AI contract suite

Use the existing mock LLM development fixtures as the basis for automated tests.

Authorization tests must assert **zero provider calls** for:

- Missing/invalid CSRF.
- Missing cookies, expired/revoked sessions, and invalid additional-account context.
- GET or wrong content type.
- Disallowed cross-site Sec-Fetch requests.
- Disabled plugin, admin feature, account feature, or per-user feature.
- Missing required consent where the product requires it.

Protocol tests must cover:

- All four draft modes, sent-thread inclusion, subject/no-subject, Unicode, and empty output.
- Exact `start`/`delta`/`done`/`error` sequencing.
- Arbitrarily split SSE lines/JSON, CRLF and LF, `[DONE]`, content arrays, split reasoning tags, malformed JSON, and missing final newline.
- Cancellation and abrupt disconnect, with concurrency gauges returning to baseline.
- Oversized bodies/fields, slow consumers, and bounded-memory soak behavior.
- Logs proving absence of prompts, mail bodies, responses, cookies, CSRF tokens, authorization headers, and API keys.

## 10. Phase 5 — Optional Rust AI streaming sidecar

### 10.1 Go/no-go criteria

Proceed only when one or more of these are demonstrated:

- Target AI concurrency saturates FPM or materially worsens unrelated mailbox p95/p99 latency.
- The measured PHP worker/memory cost of streaming exceeds the added sidecar cost by an operationally meaningful margin.
- Provider-network isolation or independent streaming lifecycle management is an explicit architectural requirement.
- The complete security and compatibility design can preserve existing behavior without exposing internal credentials or authorization bypasses.

Do not proceed solely because Rust is expected to be faster. This workload is predominantly network-I/O-bound; the primary issue is synchronous worker occupancy.

If the go criteria are not met, retain the hardened PHP endpoint and revisit after production measurements.

**Phase 5 implementation decision:** GO under the explicit provider-stream isolation and independent lifecycle requirement, not under a claimed performance result. PHP relinquishes the FPM worker after authenticated preparation; Rust then owns upstream streaming under separate privileges, limits, cancellation, health, and restart policy. The accepted tradeoff is an additional supervised runtime, a loopback prepare hop, credential bootstrap, and a larger deployment/test matrix. No measured latency, throughput, memory, or concurrency gain is claimed. The sidecar remains draft-only and default-disabled, with the intact PHP endpoint as the deliberate rollback path and no automatic post-dispatch replay. Deployments that do not require this isolation/lifecycle boundary should leave it disabled.

### 10.2 Recommended responsibility split: prepare in PHP, stream in Rust

The first increment covers draft streaming only. Non-streaming summaries, quick replies, search, triage, chat, alerts, caching, and tools remain in PHP.

Request sequence:

1. The browser calls a new same-origin, base-path-aware `POST` route for `/api/ai/stream` through the existing `streamEvents()` client helper.
2. The public Nginx route forwards this explicit internal path to Rust with response buffering disabled.
3. Rust applies body/schema size limits and a bounded global preparation-concurrency limit. It cannot apply a trusted per-account limit yet because PHP has not authenticated the request.
4. Rust calls a loopback-only internal PHP `prepare` RPC, forwarding the original cookies, CSRF token, required request headers, request ID, and draft parameters.
5. PHP performs the existing account/session/CSRF checks, feature/consent gates, IMAP context retrieval, prompt construction, provider selection, timeout resolution, and secret resolution.
6. PHP returns a transient internal preparation result containing an opaque account-limit key and exits, releasing the FPM worker before upstream streaming begins.
7. Rust derives no identity from browser input: it uses the authenticated preparation result to acquire the per-account permit and a global upstream-stream permit before provider dispatch. Every error, cancellation, and disconnect path must release all acquired permits.
8. Rust performs the upstream request, parses the provider stream, applies backpressure/cancellation, and emits the compatible downstream SSE events.
9. Rust cancels upstream work when the downstream client disconnects and releases all permits/buffers.

PHP preparation still consumes a worker briefly, especially during IMAP context retrieval. Therefore “zero PHP worker usage” is neither accurate nor required; the objective is to remove long upstream streaming from FPM occupancy.

### 10.3 Protect the internal preparation RPC

The internal RPC is highly sensitive because it may return resolved provider configuration and, for encrypted admin settings, a decrypted provider credential.

PHP-FPM speaks FastCGI, not HTTP. The implementation must choose an explicit transport rather than pointing an HTTP client at port 9000:

- **Recommended same-host transport:** Add a separate Nginx server listening only on a loopback address and private port, with one exact internal prepare location forwarding to FPM through FastCGI. Rust calls that loopback HTTP endpoint. The public Nginx server must not contain a route to this internal action.
- **Alternative:** Rust speaks FastCGI directly over the loopback/Unix-domain FPM socket using a reviewed client implementation. This removes the internal HTTP hop but adds protocol and deployment complexity.

Requirements:

- Bind the RPC transport only to loopback or a Unix-domain socket in the initial same-host design.
- Require a separate service credential in addition to forwarded user cookies/CSRF.
- Never expose the RPC on the public Nginx listener or a published container port.
- Never accept account identity, provider URL, model, or API key directly from the browser.
- Keep request/response bodies out of access logs, error logs, traces, and panic reports, including logs on the internal Nginx server.
- Use short-lived, single-purpose preparation data; do not create a persistent prompt/job store.
- If processes are later separated across hosts or an untrusted network, use an authenticated encrypted private channel such as mutually authenticated TLS and redesign secret handling explicitly.
- Prefer returning a secret reference when Rust can resolve the same environment/key-file source. If admin-encrypted keys must be supported, document that PHP transmits the decrypted secret only over the protected internal channel.
- Ensure SSRF protections remain enforced for configurable provider base URLs, including redirects, DNS changes, and disallowed address ranges where applicable.
- Test that the prepare action is unreachable through external/public interfaces, invalid service credentials are rejected, and every rejected preparation results in zero provider calls.

### 10.4 Rust service boundaries and implementation requirements

Use one consistently named crate, for example `crates/snappy-ai-proxy`, with a committed `Cargo.lock`.

Suggested stack:

- `axum` for HTTP routing.
- `tokio` for asynchronous tasks, timeouts, cancellation, and bounded concurrency.
- `reqwest` with `rustls` for provider HTTPS, subject to build and compatibility validation.

Required behavior:

- Bound request bodies, headers, parser buffers, response accumulation, and queue sizes.
- Use bounded channels and global/per-account semaphores; reject or shed excess work explicitly rather than queueing without limit.
- Apply backpressure to slow downstream clients and bound buffered deltas.
- Preserve provider certificate/hostname verification and disabled redirects.
- Require HTTPS for remote providers. Plain HTTP is allowed only as an explicit local-provider profile exception.
- Define and test the TLS version policy separately from ZDR. Do not claim TLS 1.3 support or necessity without validating the provider and deployment requirements.
- Preserve configured connect/total timeouts and add a documented idle timeout.
- Parse provider usage metadata when available without treating it as guaranteed for every stream.
- Return a terminal error when upstream EOF is incomplete or malformed.
- Avoid per-token allocations and unbounded full-response copies where practical, but prioritize protocol correctness over micro-optimization.
- Run as an unprivileged user with no write access to mail data. The streaming service should not need the private-data volume.
- Disable core dumps and content-bearing debug output in production.

Do not add `/api/ai/complete` speculatively. Migrating synchronous AI calls is a separate project because their JSON envelopes, caching, chat tools, and provider routing differ substantially.

### 10.5 Nginx and UI integration

Prefer an explicit `location = /api/ai/stream` rather than attempting to match the legacy query-string route.

The Nginx configuration must:

- Use HTTP/1.1 upstream streaming and disable proxy response buffering/caching.
- Pass cookies, `X-SM-Token`, content type, and required security headers unchanged.
- Apply a small request-body limit consistent with Rust and PHP.
- Align proxy read/idle timeouts with the sidecar policy.
- Avoid buffering a large response to disk.
- Keep health and internal prepare endpoints private.
- Preserve all generic PHP routes and static behavior.

Extend `streamEvents()` inside `ui/src/api.ts`; do not create another HTTP client. A server-provided deployment capability/configuration should select the new route, while old/cached clients can continue using `/?/AiStream/`. Construct the browser URL through the existing `root()` handling and a server-provided route rather than assuming that the application is mounted at the origin root. The exact `/api/ai/stream` Nginx location is the internal container route; an external reverse proxy may expose it below a path prefix. Add a prefixed-proxy integration test covering cookies, CSRF, streaming, cancellation, and rollback.

Do not automatically fall back from Rust to PHP after a request may have reached the provider. Automatic replay can duplicate generated content and cost. Fallback is safe only when non-dispatch is established, or as a deliberate new user action after a clear failure.

### 10.6 Process model and health

For the smallest operational change, start with Rust as an additional supervised process in the same private container/network boundary:

- Nginx remains the only public HTTP entry point.
- PHP prepare and Rust listen only on loopback/private interfaces.
- Sidecar failure marks the streaming capability unavailable and drives readiness according to an explicit policy.
- Supervisor/orchestrator restart behavior is tested; do not leave a silently half-functional container.
- Health checks never invoke a live model.

A separate sidecar container can be evaluated later if independent scaling is required, but it increases internal authentication, secret transport, networking, and deployment complexity.

### 10.7 Rust verification and supply-chain gates

Add:

- `cargo fmt --check`
- `cargo clippy` with warnings treated according to a documented strictness policy
- Unit, integration, fuzz/property tests for stream parsing and subject processing
- Concurrency, cancellation, slow-client, and bounded-memory soak tests
- Dependency vulnerability and license checks
- Reproducible release build with committed lockfile and pinned Rust toolchain
- Static/musl or glibc decision based on actual dependency compatibility, image size, and operational debugging needs; do not promise a fixed binary size
- Runtime tests for every published architecture, including AMD64, ARM64, and `linux/386` while 386 remains published. If Rust cannot support an architecture, either ship an explicitly documented and tested PHP-only variant with equivalent capability/rollback tests or stop publishing that architecture; never silently omit the sidecar.

## 11. Privacy, ZDR, secrets, and audit requirements

### 11.1 Separate three different claims

1. **Transport security:** Remote provider calls use verified HTTPS, explicit timeout/redirect policy, and a tested TLS configuration.
2. **Local content handling:** The sidecar does not intentionally persist prompts, mail content, or responses and does not write them to logs. Existing PHP AI caches and other application behavior must be documented separately.
3. **Provider retention/ZDR:** Determined by the provider account, API behavior, configuration, and contract. It cannot be proven or enforced by Rust alone.

All product and operations documentation must preserve this distinction.

### 11.2 Account for existing caches and diagnostics

Current plugin behavior includes caches for operations such as summaries and quick replies, and diagnostic options can expose content if enabled indiscriminately. The privacy workstream must:

- Inventory every AI cache, debug log, request/response log, exception path, trace, metrics label, crash dump, and administrative export.
- Document cache location, driver, retention, encryption/access control, deletion behavior, and whether `cacheOnly` operations stay local.
- Ensure the sidecar adds no application-level content cache.
- Test production configuration with content-bearing diagnostics disabled.
- Consider swap/core-dump/host logging as operational data-handling concerns without promising absolute erasure from memory.
- Provide a data-flow diagram for administrators showing browser, Nginx, PHP, Rust, local caches, and provider boundaries.

### 11.3 Privacy-safe observability

Useful metadata includes:

- Random request ID for private troubleshooting, not a high-cardinality metrics label.
- Pseudonymous/stable account key for per-account limits, with an appropriate retention policy.
- Profile and model label, avoiding user content.
- Prepare, upstream-connect, first-delta, and total timings.
- Upstream status class, retry reason, cancellation reason, and terminal outcome.
- Active streams, rejected/queued requests, buffer high-water marks, and provider token usage when returned.

Never log or label:

- Message IDs that can be joined to content without an explicit need.
- Folder names, subjects, recipients, prompts, responses, or draft bodies.
- Cookies, CSRF tokens, bearer tokens, API keys, decrypted settings, or internal RPC bodies.

Health endpoints must reveal only minimal status and must not become a provider oracle.

## 12. Phase 6 — Frontend runtime improvements selected by profiles

These improvements are independent of the Rust decision and should be implemented in small, separately measured changes.

### 12.1 Startup and polling

- Identify independent startup requests and run them concurrently only after checking ordering dependencies.
- Add an in-flight guard to mailbox polling so slow requests cannot overlap.
- Add abort/cancellation for obsolete list requests where safe; sequence checks alone discard stale responses but do not stop network/server work.
- Add bounded backoff after failures and avoid immediate retry storms on visibility restoration.
- Measure time to first usable mailbox, first message row, request count, and server load.

### 12.2 Message-list rendering

- Profile selection, flagging, checking, and list refreshes with 20, 100, and 1,000 loaded rows.
- Replace unchanged-row full reconstruction with keyed or incremental updates where beneficial.
- Preserve focus, keyboard navigation, selection, screen-reader state, and German UI behavior.
- Consider pagination/windowing only after keyed updates are measured; virtualization adds significant mailbox interaction complexity.

### 12.3 Browser memory and image handling

- Bound inline-image and calendar caches by bytes and/or entry count.
- Clear account-scoped caches on logout and account change.
- Limit concurrent inline/proxied image fetches.
- Enforce download limits while streaming responses rather than after reading an entire blob.
- Avoid unnecessary blob-to-base64 copies and revoke object URLs/resources when no longer needed.
- Measure JS heap and browser-process memory after repeated HTML-mail opens, logout, and account switching.

### 12.4 Frontend verification

In addition to typecheck/build:

- Add browser smoke tests for login, folders, message list/read, drafts, settings/admin, logout/reauthentication, downloads, and plugin-disabled behavior.
- Track LCP, INP, CLS, long tasks, JS parse/evaluate time, bytes transferred, and DOM-node counts where relevant.
- Test desktop and mobile viewports and cold/warm caches.
- Respect the repository's existing visual, focus, overflow, hover, iframe, and capability-gating rules.

## 13. CI, release, upgrade, and deployment completion

### 13.1 Correct release-chain issues before publishing optimized images

- Resolve the mismatch between a release workflow triggered by `v2.*` tags and the repository's current `3.0.0` package version.
- Review fork-specific image labels, registry ownership, namespaces, and credentials.
- Replace `latest` test-tool references with pinned versions/digests.
- Run equivalent runtime tests for every published architecture, or explicitly stop publishing untested architectures.
- Ensure the release uses a deliberate frontend build/package stage rather than ambiguous legacy `skip-gulp` terminology.
- Verify that committed static assets match sources before building the release image.

### 13.2 Prevent upstream upgrades from overwriting this fork

The existing shell/admin upgrade paths reference upstream distribution channels. Before treating this fork as an independently released product:

- Disable or repoint those channels deliberately.
- Test fresh installation, previous-fork-version upgrade, and rollback.
- Verify that fork-specific UI, plugin, PHP, and configuration changes survive upgrades.
- Define data backup and persistent-volume compatibility checks.
- Ensure OPcache invalidation/restart semantics are correct for every supported update mode.

### 13.3 Preserve non-Rust deployment modes

ZIP/TAR, Apache, Nextcloud/ownCloud, and other non-Docker installation paths cannot assume a Rust process exists.

- Keep the PHP streaming endpoint functional.
- Make Rust capability discovery explicit; do not display a fabricated “not connected” state when the assistant is simply using PHP or disabled.
- Document feature parity and any concurrency limits without introducing a second product UI.
- Test plugin disabled, account disabled, per-user feature disabled, and provider unconfigured states.

### 13.4 Canary and rollback procedure

For each runtime/image optimization:

1. Deploy to staging with the real plugin/configuration matrix.
2. Run correctness tests and the fixed benchmark suite.
3. Canary through a representative traffic period, including combined mail and AI load.
4. Compare against the previous image digest using the same host limits and metrics.
5. Roll back on correctness, security, memory, latency, queueing, thumbnail, authentication, database, or cryptographic regressions.

For the Rust rollout:

1. Default new installations to the proven PHP path until the sidecar passes the full contract suite.
2. Enable Rust for a small staging/canary cohort through deployment configuration.
3. Keep old and new clients interoperable during rollout.
4. Do not automatically replay provider requests across backends.
5. Roll back by selecting the PHP route and restoring the previous image digest; no data migration should be required.
6. Drain active streams gracefully where possible and verify that concurrency/connection gauges return to baseline.

## 14. Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| RAM target is met by reducing capacity | Queued requests, timeouts, poor mailbox latency during AI load | Derive FPM limits from memory and concurrency measurements; gate on queue and p95/p99 metrics |
| OPcache serves stale code | Development confusion or broken upgrades | Environment-specific config; immutable replacement or explicit invalidation/restart |
| Removing LESS support breaks custom themes/plugins | Upgrade compatibility failure | Inventory, migration period, release notice; defer removal |
| GD-only thumbnails lose formats or weaken image handling | Attachment errors/regressions | Full format/security matrix, graceful fallback, or retain/harden Imagick |
| Rust prepare RPC is exposed | Authentication bypass or provider-key disclosure | Loopback/Unix socket, service authentication, no public route, no body logging, security review |
| Browser fallback repeats a stream | Duplicate content and provider cost | No automatic fallback after possible upstream dispatch |
| Provider retries duplicate generation or partial output | Corrupted drafts and extra cost | Retry only with established non-dispatch or effective provider idempotency; never retry ambiguous post-dispatch failures automatically; use bounded backoff/jitter |
| Slow clients exhaust Rust memory | Sidecar OOM affecting all streams | Bounded queues/channels, backpressure, concurrency caps, slow-client tests |
| Local no-persistence claim ignores existing caches | Misleading privacy/compliance documentation | Complete data-flow/cache inventory and precise claims |
| TLS/ZDR language overstates guarantees | False compliance assurance | Treat transport, local handling, and provider retention separately |
| Cleaner deletes active drafts or database state | Data loss/corruption | Exact allowlists, conservative TTL, symlink checks, locks/leases, never unlink SQLite sidecars |
| Frontend asset cache mixes versions | Broken UI after upgrade/rollback | Versioned URLs, cache negotiation tests, coordinated artifact deployment |
| Upstream updater overwrites fork code | Product regression or service outage | Disable/repoint updater and test upgrade/rollback |
| Multi-architecture images are untested | Architecture-specific runtime failure | Equivalent runtime tests or explicit architecture removal |
| Additional sidecar increases operational burden | More failure modes than resource benefit | Go/no-go gate, PHP-only support, minimal initial scope, measured canary |

## 15. Detailed implementation checklist

### Phase 0 deliverables

- [ ] Versioned benchmark environment description and immutable mail/LLM fixtures.
- [ ] Repeatable image, cgroup, process, FPM, latency, throughput, and error metrics.
- [ ] Cold/warm browser baseline and bundle-composition reports.
- [ ] Existing PHP SSE golden/contract tests.
- [ ] Storage lifecycle and privacy data-flow inventory.
- [ ] CI typecheck/build/generated-artifact drift checks.
- [ ] Documented service objectives and regression thresholds.

### Phase 1 deliverables

- [ ] Clean Docker context and deterministic, pinned build inputs.
- [ ] OPcache installed, verified, sized, and environment-specific invalidation documented.
- [ ] JavaScript minification and bundle budgets.
- [ ] Health/readiness checks with no live-model dependency.
- [ ] Static cache/compression tests and upgrade/rollback asset checks.

### Phase 2 deliverables

- [ ] FPM candidate comparison with queue, capacity, memory, and latency results.
- [ ] Independent extension-removal reports with feature matrices.
- [ ] Imagick/GD decision based on correctness, security, size, and memory evidence.
- [ ] Trusted-proxy and private-metrics/network configuration reviewed.

### Phase 3 deliverables

- [ ] Nonblocking client maintenance trigger.
- [ ] Shared PHP maintenance service with independent retryable schedules.
- [ ] Optional one-shot CLI scheduling with correct UID/GID and persistent volume.
- [ ] File allowlists, symlink/concurrency safeguards, and conservative retention.
- [ ] Tests proving active data and SQLite sidecars are preserved.

### Phase 4 deliverables

- [ ] Server-side consent/feature enforcement and complete authorization tests.
- [ ] Request/body/schema bounds.
- [ ] Robust server/client SSE parsing and mandatory terminal completion semantics.
- [ ] Cancellation, timeout, retry, slow-client, and privacy tests.
- [ ] Automated mock-provider suite covering both success and failure paths.

### Phase 5 deliverables, only after a go decision

- [ ] Internal PHP prepare RPC with complete authentication/feature/context behavior.
- [ ] Protected secret-resolution design and security review.
- [ ] Bounded Rust streamer with cancellation, backpressure, timeouts, and safe retries.
- [ ] Explicit Nginx route and existing `streamEvents()` integration.
- [ ] Legacy PHP route and old-client compatibility.
- [ ] Rust quality, supply-chain, concurrency, memory, and multi-architecture gates.
- [ ] Canary/rollback drill and comparative benchmark report.

### Phase 6 deliverables

- [ ] Poll overlap prevention and failure backoff.
- [ ] Measured startup-request scheduling improvements.
- [ ] Keyed/incremental list updates where profiles justify them.
- [ ] Bounded account-scoped caches and cleanup on logout/account change.
- [ ] Streaming image-size enforcement and fetch concurrency limits.
- [ ] Browser interaction, accessibility, heap, and soak verification.

### Phase 7 deliverables

- [ ] Correct fork-specific release tags, metadata, registries, and updater channels.
- [ ] Reproducible frontend/container release pipeline.
- [ ] Fresh install, upgrade, rollback, and persistent-data verification.
- [ ] Supported PHP-only/non-Docker deployment documentation.
- [ ] Final resource/latency report replacing hypotheses with measured results.

## 16. Final definition of done

This plan is complete only when:

- Every optimization has an attributable before/after measurement from a reproducible environment.
- Core mailbox performance does not regress while AI streams are active at the agreed target concurrency.
- FPM capacity is chosen from measured memory and service objectives, not fixed guesses.
- Image slimming has no undocumented feature loss.
- Temporary-file maintenance is reliable and cannot delete active drafts or SQLite state files.
- AI authorization, consent, capability gates, cancellation, retries, and SSE behavior are covered by automated tests.
- Local privacy claims accurately include existing caches, and provider ZDR is not misrepresented as a property enforced by the sidecar.
- Rust, if introduced, is bounded under slow clients and failures and adds no publicly accessible internal RPC.
- UI artifacts are reproducible, minified where beneficial, cached safely, and protected by size/performance budgets.
- Fresh install, upgrade, canary, rollback, multi-architecture, and PHP-only deployment paths are verified.
- The final report documents remaining tradeoffs and unmeasured environments instead of converting estimates into guarantees.
