# Agent Guidelines: EnterpriseMail

EnterpriseMail (repository `zfzfg/EnterpriseMail`) is a modern, high-performance webmail suite based on SnappyMail. It replaces the legacy Knockout.js interface with a responsive, modern TypeScript and Tailwind CSS v4 frontend, backed by hardened PHP 8.5/8.2 with OPcache JIT and an optional Rust streaming sidecar for Zero Data Retention (ZDR) AI assistance.

For performance benchmarks, architectural background, and sizing guidelines, refer to [PLAN-performance-and-rust-expanded.md](file:///c:/Users/zfzfg/Documents/HammerMegaProjekte/SnappyMail-Tailwind-Mistral/snappymail/PLAN-performance-and-rust-expanded.md) and [benchmark/fpm-sizing.md](file:///c:/Users/zfzfg/Documents/HammerMegaProjekte/SnappyMail-Tailwind-Mistral/snappymail/benchmark/fpm-sizing.md).

---

## 1. Repository Layout & Core Paths

* **`ui/` (Frontend):** Pure TypeScript and Tailwind CSS v4 SPA. Zero Knockout.js dependencies.
  * `ui/src/main.ts`: Main webmail client application entrypoint.
  * `ui/src/admin.ts`: Independent administration console entrypoint.
  * `ui/src/api.ts`: **Single HTTP client** for the entire frontend. `call` interacts with `/?/Json/`, `adminCall` with `/?/{adminKey}/Json/`, `plugin` namespaces plugin endpoints, and `streamEvents` handles SSE from `/?/AiStream/` or the Rust proxy. Do not create parallel HTTP wrappers.
  * `ui/src/mail.ts`: Session state and mail actions (`act`).
  * `ui/src/view.ts`: Mailbox layout and view rendering.
  * `ui/src/reader.ts`: Message viewer and thread conversation view.
  * `ui/src/compose.ts`: Mail composer (HTML/Plain, attachment staging, recipient validation, auto-drafting).
  * `ui/src/clean.ts` & `ui/src/letter.ts`: Email sanitization and secure sandboxed `srcdoc` rendering with strict CSP, print view, ICS invitations, and List-Unsubscribe handling.
  * `ui/src/contacts.ts` & `ui/src/jcard.ts`: Address book, vCard/jCard parser, import/export.
  * `ui/src/settings.ts`: Accounts, identities, filters, encryption keys, and CardDAV synchronization.
  * `ui/src/folders.ts`: Folder tree model, sidebar navigation, folder management, and IMAP ACL sharing.
  * `ui/src/crypto.ts`: Server-assisted OpenPGP, GnuPG, and S/MIME encryption and signing without bulky client OpenPGP.js bundles.
  * `ui/src/icons/`: Pixel-aligned icon source in `icons.txt` (9×9 grid). Compiled to `ui/src/icons.ts` via `ui/scripts/icons.mjs`. Use only `icon(name)`. Every icon button requires an `aria-label`.
  * `ui/src/styles/`: Design tokens live strictly in `app-tokens.css`. Global Tailwind utility layer in `app.css`, layout shell in `shell.css`.
* **Static Assets:** Build outputs reside under `snappymail/v/0.0.0/static/` (`static/css/`, `static/js/`, `static/fonts/`). `Service.php` loads `app.*` for users and `admin.*` for administrators.
* **`crates/snappy-ai-proxy` (Rust Sidecar):** Axum + Tokio streaming proxy implementing the *Prepare in PHP, Stream in Rust* pattern for Mistral ZDR. Handles high-concurrency SSE streaming without keeping PHP-FPM worker pools occupied.
* **`plugins/`:** Curated enterprise plugins only (2FA, OAuth2, LDAP, Redis, and `ai-copilot`). All legacy and shared-hosting plugins (cPanel, Froxlor, avatars/Gravatar, snow) have been removed.
* **`plugins/ai-copilot/dev/`:** Dedicated local development and integration environment (`docker compose up -d` on `http://localhost:8888`) with integrated Dovecot/Postfix mailserver, Step-CA TLS authority, and headless test harness.

---

## 2. User Interface & Design System

* **Language & Localization:** German as primary default with full English localization support via `t(path, fallback)` and `rl.I18N`. Add new translation strings to `snappymail/v/0.0.0/app/localization/de` and `en`.
* **Design Philosophy (Mistral Visual Language):**
  * Clean, dense, tactile enterprise interface. Sharp hairline borders (1px), clear typographic hierarchy (Inter headings, Space Mono badges).
  * **Primary Actions:** Solid ink styling (background: `var(--foreground)`, text: `var(--background)`).
  * **Accent Color:** Orange (`--primary`) is reserved for notifications, the 6px "Response Required" indicator square, the 2px focus ring, and text selection (`::selection`).
  * **Secondary Text:** Uses `color-mix(in srgb, var(--foreground) 68%, transparent)` for balanced legibility in both light and dark themes.
  * **Sandbox Security:** The email body must always remain inside an isolated, sandboxed `<iframe>`.
  * **Scroll & Focus Control:** Do not trigger layout shifts or body scrolling on focus: use `focus({ preventScroll: true })`. `html`, `body`, `.shell`, and message reader panels must retain `overflow: hidden`.

---

## 3. AI Assistant & Mistral Zero Data Retention (ZDR)

* **Explicit User Intent:** AI operations are strictly opt-in and triggered only by explicit user click. Passive background checks (such as keyword categorization or unread badge counts) must be read-only without sending email payloads externally.
* **Graceful Degradation:** When the plugin is disabled or unconfigured, the UI presents zero AI chrome or fake "disconnected" banners; the mailbox behaves identically to standard email.
* **Zero Data Retention (ZDR) Compliance:**
  * Mistral ZDR guarantees contractual enterprise privacy.
  * Local services (PHP backend and Rust sidecar) must strictly ensure local compliance: **Never write prompts, email subjects/bodies, model completions, or API keys into persistent logs or temp files on disk.**
  * All AI streams are ephemerally processed in-memory.

---

## 4. Storage Safety & Database Integrity

* **SQLite Sidecars:** Never manually delete SQLite temporary database files (`.wal`, `.shm`, or rollback journals) while SQLite is active.
* **Attachment Retention:** Temporary draft attachments stored in `.files/` must be retained for at least 48 hours to prevent accidental draft corruption.
* **Automated Maintenance:** Background cache cleanup and temp file expiry are handled asynchronously via PHP's `AppDelayStart` trigger invoked from the UI after application boot.

---

## 5. Verification & Testing Standards

Always test changes before committing:

1. **Frontend Verification:**
   ```bash
   npm run typecheck --prefix ui
   npm run test --prefix ui
   npm run bundle:check --prefix ui
   npm run build --prefix ui
   ```
2. **PHP Backend & Syntax Verification:**
   ```bash
   bash scripts/ci/php.sh
   ```
3. **Rust Proxy Verification:**
   ```bash
   cd crates/snappy-ai-proxy
   cargo fmt --all -- --check
   cargo clippy --locked --all-targets -- -D warnings
   cargo test --locked
   bash ../../scripts/ci/rust-supply-chain.sh
   ```
4. **Browser Verification (Chrome Headless):**
   * Visual and end-to-end verifications are conducted using Chrome Headless against the local development environment (`plugins/ai-copilot/dev/`).
   * Visual verification screenshots belong in `plugins/ai-copilot/dev/shots/`.

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
  * Keep `ui/node_modules/`, lockfiles in repo root, local `data/`, secret files, and temporary test logs uncommitted.
  * Rebuilt static bundles under `snappymail/v/0.0.0/static/` must be included when frontend changes alter generated assets.
* **Remote:** The official upstream remote for this fork is `origin` at `git@github.com:zfzfg/EnterpriseMail.git`. Force-push only when explicitly requested by the user.
