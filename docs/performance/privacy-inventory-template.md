# Storage, lifecycle, and privacy inventory template

**Status: template, not a completed inventory or compliance claim.** Replace every `UNVERIFIED` entry with evidence linked to source, runtime inspection, or a test. Include PHP and any future Rust path separately. Do not claim ZDR, no persistence, or no logging from this document alone.

## Benchmark fixture and artifact inventory

| Data / identity | Source and destination | Persistence / retention | Logging / result policy | Evidence / owner |
| --- | --- | --- | --- | --- |
| Synthetic RFC 822 fixtures | Repository fixture → isolated docker-mailserver volume | Until benchmark volumes are explicitly removed | Bodies are not written to benchmark results | Manifest hash: UNVERIFIED until run |
| Synthetic login `test@example.com` | Host load generator → loopback SnappyMail → isolated IMAP | Benchmark session/data volumes only | Password is not an artifact field; account name is a public synthetic fixture | UNVERIFIED |
| CSRF token and cookies | SnappyMail → in-memory Python opener | Process memory; not intentionally persisted | Never write to samples/results | UNVERIFIED |
| Draft instruction/current/thread context | Load generator → PHP prepare → internal mock | Request/provider processing only in benchmark design | Mock does not log bodies; actual PHP/cache behavior: UNVERIFIED | UNVERIFIED |
| Provider key | Deliberately unusable fixture; real development key must not be used | No real key needed | Do not dump process/container environments | UNVERIFIED |
| HTTP samples | Load generator → `requests.jsonl` | Until operator deletes result directory | Operation, timing, status, bytes, generic error only; no response body | UNVERIFIED |
| FPM full status | Loopback FastCGI → parser → `metrics.jsonl` | Result directory | URI/query/script/user/auth fields dropped | UNVERIFIED |
| Host/image metadata | Docker/proc/registry inspection → `environment.json` | Result directory | Hostname and full environment intentionally excluded; review image history before sharing | UNVERIFIED |
| Application/mail logs | Containers and existing application log configuration | UNVERIFIED | Existing entrypoint enables application/auth logs; inspect before claiming content-free logs | UNVERIFIED |
| AI summary/quick-reply caches | Existing PHP plugin cache | UNVERIFIED | Inventory key/content/TTL/invalidation; benchmark draft path may not exercise these caches | UNVERIFIED |
| SnappyMail sessions/settings | `/var/lib/snappymail/` isolated volume | UNVERIFIED | Includes synthetic consent/settings; verify exact storage and retention | UNVERIFIED |
| Draft attachments / `.files/` | Not exercised by the default workload | UNVERIFIED; project rule preserves active drafts and at least 48 h | Do not clean or infer lifecycle from this harness | UNVERIFIED |
| SQLite DB and sidecars | UNVERIFIED | Never manually delete `.wal`, `.shm`, or journals | Inventory paths, backup and cleanup behavior | UNVERIFIED |
| PHP request temp files | UNVERIFIED | UNVERIFIED | Do not assume request cancellation removes all copies | UNVERIFIED |
| Rust sidecar buffers/logs | Future integration only | UNVERIFIED | No sidecar is implemented or measured by this harness | UNVERIFIED |

## Required data-flow review

For each AI action (`summarize`, `draft`, `quick_replies`, `search`, `triage_llm`, `chat`, and alerts where applicable), document:

1. Trigger and user consent evidence.
2. Exact fields read from mail, identity, settings, and prior drafts.
3. Request size bounds and truncation behavior.
4. Every process/network hop, including proxies and DNS.
5. Provider/profile/model and whether any retries or replay can occur.
6. Buffers, queues, temporary files, caches, sessions, and their retention.
7. Log statements and error paths, including HTTP 200 SSE errors and disconnects.
8. Cancellation, timeout, partial output, and cleanup behavior.
9. Local storage versus provider contractual retention, described separately.
10. Test evidence and unresolved unknowns.

## Publication checklist

- [ ] Results contain no real mailbox content, addresses, tokens, provider keys, hostnames, or private request URIs.
- [ ] Existing application/auth logs have been inspected rather than assumed empty.
- [ ] Cache and session behavior is included in privacy wording.
- [ ] No local no-persistence claim is based solely on the mock's no-body-logging policy.
- [ ] Provider ZDR is described only as a provider contract property, not something enforced locally.
- [ ] Result-directory retention and deletion owner are documented.
- [ ] Incomplete/unavailable probes remain visible in published reports.
