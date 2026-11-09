# Agent Guidelines: EnterpriseMail

EnterpriseMail (repository `zfzfg/EnterpriseMail`) is a modern, high-performance webmail suite based on SnappyMail. It replaces the legacy Knockout.js interface with a responsive, modern TypeScript and Tailwind CSS v4 frontend, backed by PHP 8.2+ (the production image runs PHP 8.5) with OPcache (64 MB shared memory, no JIT configured) and an optional Rust streaming sidecar for Zero Data Retention (ZDR) AI assistance.

For performance benchmarks, architectural background, and sizing guidelines, refer to [PLAN-performance-and-rust-expanded.md](PLAN-performance-and-rust-expanded.md) and [benchmark/fpm-sizing.md](benchmark/fpm-sizing.md).

---

## 1. Repository Layout & Core Paths

* **`ui/` (Frontend):** Pure TypeScript and Tailwind CSS v4 SPA. Knockout.js has been removed from the UI; there are no framework dependencies.
  * `ui/src/main.ts`: Main webmail client application entrypoint (`boot()` plus the deferred `AppDelayStart` maintenance call).
  * `ui/src/admin.ts`: Independent administration console entrypoint.
  * `ui/src/api.ts`: **Single HTTP client** for the entire frontend. It exposes `call` (`/?/Json/`), `adminCall` (`/?/{adminKey}/Json/`), `plugin` (`Plugin*` JSON actions), `upload` (XHR to `/?/Upload/` for progress and abort), `uploadContacts`, `syncContacts`, `rawPath`, and `streamEvents` (SSE from `/?/AiStream/` or the Rust proxy). Do not create parallel HTTP wrappers.
  * `ui/src/mail.ts`: Session state, `boot()`, and mail actions (`act`).
  * `ui/src/view.ts`: Mailbox layout and view rendering.
  * `ui/src/reader.ts`: Message viewer and thread conversation view.
  * `ui/src/compose.ts`: Mail composer (HTML/Plain, attachment staging, recipient validation, auto-drafting).
  * `ui/src/clean.ts` & `ui/src/letter.ts`: Email sanitization and sandboxed `srcdoc` rendering with strict CSP, print window, ICS invitations, and RFC 2369/8058 List-Unsubscribe handling.
  * `ui/src/contacts.ts` & `ui/src/jcard.ts`: Address book, vCard/jCard parser, import/export.
  * `ui/src/settings.ts`, `ui/src/sieve/form.ts`, `ui/src/sieve/script.ts`: Accounts, identities, Sieve filters and vacation rules, encryption keys/certificates, and CardDAV synchronization.
  * `ui/src/folders.ts`: Folder tree model, sidebar navigation, folder management, and IMAP ACL sharing.
  * `ui/src/crypto.ts`: Server-assisted OpenPGP, GnuPG, and S/MIME encryption and signing without bulky client OpenPGP.js bundles.
  * `ui/src/search.ts`, `ui/src/assistant.ts`, `ui/src/theme.ts`, `ui/src/i18n.ts`, `ui/src/runtime.ts`: Search UI, AI assistant feature flags, appearance handling, translation lookup, and shared runtime primitives (SSE parser, concurrency limiter, bounded cache, backoff).
  * `ui/src/assist-controller.ts` & `ui/src/assist-state.ts`: AI assistant behaviour (state, provider requests, results) behind the `AssistHost` interface, and its DOM-free, unit-tested rules.
  * `ui/src/icons/`: Pixel-aligned icon source in `icons.txt` (9×9 raster). Compiled to `ui/src/icons.ts` via `ui/scripts/icons.mjs`. Use only `icon(name)`. Every icon button requires an `aria-label`.
  * `ui/src/styles/`: Design tokens live strictly in `app-tokens.css`. `app.css` is the Tailwind entry point and imports tokens, fonts, and `shell.css`. Do not introduce raw color values outside the token layer.
* **Static Assets:** Build outputs reside under `snappymail/v/0.0.0/static/` (`static/css/`, `static/js/`, `static/fonts/`). `snappymail/v/0.0.0/app/libraries/RainLoop/Service.php` selects `css/{app|admin}.css` and `js/{app|admin}.js`. Generated files are committed; rebuild them when sources change.
* **`crates/snappy-ai-proxy` (Rust Sidecar):** Axum + Tokio streaming proxy implementing the *Prepare in PHP, Stream in Rust* pattern for Mistral ZDR. Handles high-concurrency SSE streaming without keeping PHP-FPM worker pools occupied. The PHP streaming path remains a supported fallback.
* **`plugins/`:** 38 tracked plugins, inherited from upstream SnappyMail (LDAP, OAuth2/O365, 2FA, Redis/APCu/Memcache, Nextcloud, etc.). Legacy hosting-specific plugins (cPanel, Froxlor, avatars/Gravatar, snow, example plugins) have been removed. `ai-copilot` is the actively developed plugin; do not add new shared-hosting integrations.
* **`plugins/ai-copilot/dev/`:** Dedicated local development and integration environment (`docker compose up -d` on `http://localhost:8888`) with an integrated Dovecot/Postfix mailserver and Step-CA TLS authority. Tooling: `seed.py` (accounts, mail fixtures), `apitest.py` (JSON/SSE calls), `mock_llm.py` (offline OpenAI-compatible provider), `browser-test.mjs` (headless Chrome acceptance and soak). Screenshots and reports in `shots/` are gitignored local evidence.

---

## 2. User Interface & Design System

* **Language & Localization:** German as primary default with full English localization support via `t(path, fallback)` and `rl.I18N`. Add new translation strings to `snappymail/v/0.0.0/app/localization/de` and `en`.
* **Design Philosophy (Mistral Visual Language):**
  * Clean, dense, tactile enterprise interface. Sharp hairline borders (1px), clear typographic hierarchy (Inter headings, Space Mono badges).
  * **Primary Actions:** Solid ink styling (background: `var(--foreground)`, text: `var(--background)`).
  * **Accent Color:** Orange (`--primary`) is reserved for notifications, the 6px "Response Required" indicator square, the 2px focus ring, and text selection (`::selection`).
  * **Secondary Text:** Uses `color-mix(in srgb, var(--foreground) 68%, transparent)` for balanced legibility in both light and dark themes.
  * **Sandbox Security:** The email body must always remain inside a sandboxed `<iframe>` (`srcdoc`, CSP `default-src 'none'`). Sanitize with `clean.ts` before rendering. Never add `allow-scripts` or relax the CSP/sandbox without a security review.
  * **Scroll & Focus Control:** Do not trigger layout shifts or body scrolling on focus: use `focus({ preventScroll: true })`. `html`, `body`, `.shell`, and message reader panels must retain `overflow: hidden`.

---

## 3. AI Assistant & Mistral Zero Data Retention (ZDR)

* **Explicit User Intent:** AI operations are strictly opt-in and triggered only by explicit user click. Passive background checks (such as keyword categorization or unread badge counts) must be read-only without sending email payloads externally.
* **Graceful Degradation:** When the plugin is disabled or unconfigured, the UI presents zero AI chrome or fake "disconnected" banners; the mailbox behaves identically to standard email.
* **Zero Data Retention (ZDR) Compliance:**
  * Provider-side ZDR is a contractual property of the provider account and **cannot be enforced by PHP or Rust**. Local code guarantees only local behavior; do not claim more in docs or UI.
  * Local services (PHP backend and Rust sidecar) must strictly ensure local compliance: **Never write prompts, email subjects/bodies, model completions, or API keys into persistent logs or temp files on disk.**
  * All AI streams are ephemerally processed in-memory. AI results are cached only in the browser session, never on the server.
  * Never automatically replay a failed provider request through another backend; a retry is an explicit user action.

---

## 4. Storage Safety & Database Integrity

* **SQLite Sidecars:** Never manually delete SQLite temporary database files (`.wal`, `.shm`, or rollback journals) while SQLite is active.
* **Attachment Retention:** Temporary draft attachments stored in `.files/` must be retained for at least 48 hours to prevent accidental draft corruption.
* **Automated Maintenance:** Background cache cleanup and temp file expiry are handled asynchronously via PHP's `AppDelayStart` trigger invoked from the UI after application boot.

---

## 5. Verification & Testing Standards

Always test changes before committing. The commands below match CI; note that `ui/package.json` has **no `test` script**, so use Node's built-in runner directly.

1. **Frontend Verification (run in this order):**
   ```bash
   npm ci --prefix ui
   npm run typecheck --prefix ui
   node --test "ui/test/*.test.mjs"
   npm run build --prefix ui
   npm run bundle:check --prefix ui
   ```
   * `bundle:check` reads the esbuild metafiles written by `build:js`, so `npm run build` must run first.
   * `bundle:baseline` updates `ui/scripts/bundle-baseline.json`; use it only for intentional size changes.
   * CI also rejects drift in generated files: `ui/src/icons.ts` and `snappymail/v/0.0.0/static/`.

2. **PHP Backend & Syntax Verification:**
   ```bash
   bash scripts/ci/php.sh                  # php -l on all tracked PHP files + 11 offline tests
   php plugins/ai-copilot/tests/run.php    # plugin unit tests (mock provider only, no network)
   ```

3. **Rust Proxy Verification:**
   ```bash
   cd crates/snappy-ai-proxy
   cargo fmt --all -- --check
   cargo clippy --locked --all-targets -- -D warnings
   cargo test --locked
   cd ../..
   bash scripts/ci/rust-supply-chain.sh
   ```
   * `rust-supply-chain.sh` requires Linux x86_64. On Windows, macOS, or ARM use `bash scripts/ci/rust-supply-chain-docker.sh`.

4. **Browser Verification (Chrome Headless):**
   * Visual and end-to-end verifications run against the local development environment (`plugins/ai-copilot/dev/`).
   ```bash
   cd plugins/ai-copilot/dev
   npm ci
   TEST_PASSWORD=test1234 ADMIN_PASSWORD="$(docker compose exec snappymail cat /var/lib/snappymail/_data_/_default_/admin_password.txt)" node browser-test.mjs
   ```
   * Use bash/WSL or Git Bash for the environment variables. The default run includes a 30-minute soak; do not shorten it for acceptance.
   * Visual verification screenshots and `browser-results.json` belong in `plugins/ai-copilot/dev/shots/` (gitignored).

---

## 6. Git & Commit Guidelines

* **Language:** Commit messages must be written in **English** using conventional commit style:
  * `feat:` for new capabilities.
  * `fix:` for bug fixes and patches.
  * `perf:` for performance optimizations.
  * `chore:` for cleanup, dependencies, or maintenance.
  * `ci:` for CI/CD workflow and script improvements.
  * `docs:` for documentation updates.
* **Frequency:** Commit regularly and incrementally after each logically complete and verified step. Avoid uncommitted work accumulation.
* **Clean Staging:**
  * Stage only files directly relevant to the feature or fix.
  * Keep `ui/node_modules/`, root-level lockfiles, local `data/`, secret files, temporary test logs, and `plugins/ai-copilot/dev/shots/` uncommitted.
  * Rebuilt static bundles under `snappymail/v/0.0.0/static/` and `ui/src/icons.ts` must be included when frontend changes alter generated assets.
  * `docs/features-and-roadmap.md`, `docs/deployment-hybrid-headscale.md`, and `ui/icons.html` are intentionally local-only (gitignored).
* **Remotes & Upstream:**
  * `origin` is the fork: `git@github.com:zfzfg/EnterpriseMail.git`.
  * `upstream` is SnappyMail: `git@github.com:the-djmaze/snappymail.git`; `rainloop` is the legacy RainLoop remote.
  * This fork is heavily diverged. Do not merge `upstream/master` blindly; cherry-pick security-relevant fixes and document skipped patches.
  * Force-push only when explicitly requested by the user.

---

## 7. Known Constraints

* `ui/src/mail.ts` and `ui/src/view.ts` are large, monolithic state/render modules. Prefer extracting feature modules instead of growing them; do not add a second rendering approach.
* `ui/test/` covers runtime primitives and `api.ts`. The HTML sanitizer (`clean.ts`), composer, reader, and mail-state transitions still need stronger regression coverage; add tests with any change in those areas.
* The Rust sidecar is optional; changes must keep the PHP-only deployment path working.
