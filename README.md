# EnterpriseMail

**EnterpriseMail** is a modern, ultra-lightweight, and high-concurrency enterprise webmail client. It combines a rock-solid, standards-compliant IMAP/SMTP backend with a bespoke **TypeScript & Tailwind CSS frontend** and a high-performance **Rust streaming sidecar** designed for **Mistral AI (Zero Data Retention)** integration.

Originally forked from [SnappyMail](https://github.com/the-djmaze/snappymail) (itself a successor to RainLoop), EnterpriseMail has been thoroughly modernized, hardened, and decoupled from 10+ years of legacy UI bloat.

---

## Key Highlights

- **Bespoke TypeScript Frontend:** Completely rewrites the legacy Knockout.js/jQuery UI. Built with clean, modern TypeScript, Tailwind CSS v4, and esbuild. No bloated SPA framework. Minified bundle transfer size is only **~115 KB gzip** (`app.js`).
- **Rust AI Streaming Sidecar (`crates/snappy-ai-proxy`):** An asynchronous proxy powered by Axum and Tokio. Handles long-lived Server-Sent Events (SSE) from AI providers without blocking PHP worker processes.
- **Mistral Zero Data Retention (ZDR) Ready:** Implements a strict *Prepare in PHP, Stream in Rust* pattern. Enforces local privacy: zero prompt persistence on disk, no email bodies or tokens in server logs.
- **Ultra-Lean Docker Footprint:** Idle memory usage is only **~75–80 MB RAM**. Under heavy load (25 concurrent mailbox users + 30 active AI streams), the entire container peaks **under 200 MB RAM**.
- **Precompiled OPcache:** Integrated into the release Docker image with 64 MB shared memory, serving over 1,000 PHP files with zero memory waste.
- **Purged Legacy Code:** Over **160,000 lines of dead code removed** (unneeded cPanel/webhost plugins, Knockout runtime engines, and tracking/avatar scripts).
- **Hardened IMAP/SMTP Core:** Preserves the battle-tested PHP `MailSo` library that handles all real-world RFC quirks, S/MIME, and GnuPG cryptography.

---

## Architecture: Prepare in PHP, Stream in Rust

```
                        ┌───────────────────────────────┐
                        │      Client Browser (UI)      │
                        └───────────────┬───────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                         │      Nginx (Port 8888)      │
                         └──────────────┬──────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
      Path: /api/ai/stream                          All other API calls
        (SSE Streaming)                              (/?/Json/, static, etc.)
                 │                                             │
                 ▼                                             ▼
    ┌─────────────────────────┐                   ┌─────────────────────────┐
    │     Rust AI Sidecar     │  Internal RPC     │         PHP-FPM         │
    │  (crates/snappy-ai-proxy│ ◄─────────────────┤   - Session & Auth      │
    │  - Axum + Tokio         │  (Loopback only)  │   - IMAP Context        │
    │  - Bounded Memory       │                   │   - Prompt Building     │
    │  - Memory: ~12 MB       │                   │   - Memory: ~50 MB      │
    └────────────┬────────────┘                   └─────────────────────────┘
                 │ (Worker released in 10ms)
                 ▼
       Mistral ZDR Endpoint
       (api.mistral.ai/v1)
```

1. **Client Request:** Browser triggers an AI draft or summary request to `/api/ai/stream`.
2. **PHP Preparation (10ms):** Rust verifies authentication against an internal loopback-only PHP RPC. PHP validates session/CSRF, retrieves IMAP thread context, builds the prompt, and returns the payload to Rust.
3. **Immediate Worker Release:** The PHP worker finishes immediately and is instantly free to process other emails.
4. **Rust Async Streaming:** Rust establishes a secure TLS 1.3 connection to Mistral and streams tokens via SSE directly to the browser with backpressure, timeouts, and automatic cancellation.

---

## Benchmark & Verified Resource Usage

Extensively benchmarked across **210 repeatable runs** under controlled container constraints (2.0 CPUs, 1 GB RAM ceiling, 512 PIDs):

| Workload Scenario | Description | Total Container RAM | PHP-FPM PSS (Private RAM) | OOM Events |
| :--- | :--- | :---: | :---: | :---: |
| **Idle / Single User** | Fresh boot, 1 user browsing | **77.4 MB** | **16.0 MB** | **0** |
| **Normal Team Load (10 Users)** | 10 concurrent users browsing 100-message folders | **139.9 MB** | **86.3 MB** | **0** |
| **Peak Mail Load (25 Users)** | 25 concurrent users browsing large mailboxes | **190.2 MB** | **135.6 MB** | **0** |
| **Heavy AI Load (30 Streams)** | 30 concurrent users streaming AI drafts | **198.7 MB** | **137.2 MB** | **0** |
| **Combined Load (Mail + AI)** | 10 active mail users + 5 concurrent AI streams | **199.5 MB** | **138.6 MB** | **0** |

*All scenarios maintained 0 OOM kills and 0 dropped connections.*

---

## Features

### Mailbox & Communication
- **Three-Pane Responsive Layout:** Clean mail list, folder hierarchy, and sandboxed iframe for secure email rendering.
- **Modern Draft Composer:** Automatic background draft saving, non-strict address validation, and persistent compose sessions.
- **Unified Address Book:** CardDAV synchronization, jCard import/export, and instant search.
- **Sieve Filters & Vacation Rules:** Visual rule builder and out-of-office autoresponder with raw Sieve fallback.
- **Enterprise Security:** S/MIME and GnuPG encryption, Autocrypt support, 2FA (TOTP), and OAuth2 / O365 authentication.

### AI Assistant (Mistral Copilot)
- **Draft Generator:** Composes, rewrites, proofreads, and tunes tone (Formal, Direct, Warm) based on the email thread.
- **Thread Summarizer:** Condensed summaries and action items from multi-message conversations.
- **One-Click Quick Replies:** 3 contextual smart-reply suggestions generated on demand.
- **Natural Language Search:** Find emails using natural queries (only query terms are sent to model).
- **Flexible Profiles:** Switch models and endpoints centrally in the Admin UI (`mistral-large-latest`, `mistral-small-latest`, or local Ollama/vLLM endpoints).

---

## Quickstart (Development Preview)

The quickest way to run EnterpriseMail locally with a pre-configured test mail server:

```sh
# Clone the repository
git clone https://github.com/zfzfg/snappymail.git enterprisemail
cd enterprisemail

# Start the development stack (Webmail, Mailserver, Mock LLM)
cd plugins/ai-copilot/dev
docker compose up -d
python seed.py
```

### Accessing the Preview:
- **Webmail UI:** [http://localhost:8888](http://localhost:8888)  
  Credentials: `test@example.com` / `test1234` (or `kollege@example.com` / `test1234`)
- **Admin Panel:** [http://localhost:8888/?admin](http://localhost:8888/?admin)  
  Username: `admin`  
  Password can be read via:
  ```sh
  docker compose exec snappymail cat /var/lib/snappymail/_data_/_default_/admin_password.txt
  ```

*For live Mistral API calls, place your key in `MISTRAL-API-KEY.env` or configure it in the Admin panel under Plugins → ai-copilot.*

---

## Building from Source

### Frontend (`ui/`)
Requirements: Node.js 22+

```sh
cd ui
npm install

# Build static assets (JavaScript, CSS, fonts, icons)
npm run build

# Run typechecks and bundle size check
npm run typecheck
npm run bundle:check
```

Build outputs are compiled directly to `snappymail/v/0.0.0/static/`:
- `static/js/app.js` (Mailbox client bundle)
- `static/js/admin.js` (Admin client bundle)
- `static/css/app.css` (Tailwind CSS v4 stylesheet)

### Rust AI Sidecar (`crates/snappy-ai-proxy/`)
Requirements: Rust 1.85+ / Cargo

```sh
cd crates/snappy-ai-proxy
cargo check
cargo test
```

---

## Production Docker Deployment

Production container images are published to GitHub Container Registry:

```sh
docker run -d \
  -p 8888:8888 \
  -v enterprisemail-data:/var/lib/snappymail \
  -e MEMORY_LIMIT=128M \
  -e UPLOAD_MAX_SIZE=25M \
  ghcr.io/zfzfg/snappymail:latest
```

### Environment Configuration:
- `MISTRAL_API_KEY`: API key for Mistral AI (or mount a secret file to `/run/secrets/mistral.env`).
- `MEMORY_LIMIT`: PHP memory ceiling per request (default: `128M`, recommended: `64M` to `128M`).
- `UPLOAD_MAX_SIZE`: Attachment size limit (default: `25M`).
- `SECURE_COOKIES`: Set `true` when running behind HTTPS reverse proxy.

---

## Testing & Quality Assurance

EnterpriseMail enforces strict quality gates:
- **CI Workflow:** Every commit validates PHP 8.2 and PHP 8.5 syntax, executes Rust unit & integration tests, checks bundle budgets, and runs full container integration drills.
- **End-to-End Verification:** Automated headless Chrome tests (`plugins/ai-copilot/dev/browser-test.mjs`) verify real user journeys, CSP sandbox isolation, and memory soak stability.
- **Supply Chain Security:** Cargo dependencies are audited via `cargo-audit` and `cargo-deny` with zero known vulnerabilities.

---

## License

This project is licensed under the **GNU Affero General Public License v3.0** (`AGPL-3.0`). See [LICENSE](LICENSE) for details.

*Copyright and upstream history remain with SnappyMail (`the-djmaze`) and RainLoop.*
