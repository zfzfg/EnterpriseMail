# Phase 0/2 benchmark and metrics harness

## Scope

This harness implements reproducible Phase 0 baseline collection and Phase 2 FPM candidate comparison without a live AI provider. It supports:

- FPM `pm.max_children` candidates **8, 16, and 30**, retaining `ondemand`, the existing idle timeout, and the existing request recycling setting.
- Anonymous boot, authenticated folder/list/read, AI draft streaming, and combined mailbox-plus-AI workloads.
- Mailbox concurrency 1/10/25 with requested 20/100-row pages; AI concurrency 1/5/10/30.
- A documented warm-up followed by at least five measured repetitions. The runner rejects fewer than five.
- Exact source/config/fixture hashes, container and image identity, host/Docker/kernel/architecture, container limits, cgroup and process memory, FPM private status, request latency, throughput, errors, and timeouts.

It does **not** claim to cover browser cold/warm rendering, attachments, 10,000/100,000-message mailboxes, cancellation/soak, upgrade/rollback, or extension-removal decisions. Those remain separate plan work. No savings, optimum, or regression threshold is inferred by the tooling.

## Safety and isolation

The runner merges the existing `plugins/ai-copilot/dev/docker-compose.yml` with `benchmark/docker-compose.yml` using the separate Compose project `snappymail-phase02`. The development project, its files, its port 8888, and its volumes are not modified.

The benchmark project:

- publishes only SnappyMail on `127.0.0.1:18888` by default;
- uses an `internal: true` Docker network, so runtime containers have no external network route;
- uses synthetic `example.com` accounts and immutable messages only;
- replaces the development provider-key mount with a deliberately unusable fixture;
- selects `llmster` at `http://mock-llm:18080/v1`, while the fallback Mistral URL is loopback port 9;
- publishes neither the mock provider nor FPM port 9000;
- queries FPM through a direct loopback FastCGI client, not a public HTTP exporter;
- refuses measurement if public `/status` is not HTTP 401/403/404, if FPM fields leak, or if port 9000 is published.

`--build` may access package/image registries. Registry access is build/metadata activity, never model traffic. Docker Engine is not installed in the shell used to create this harness, so Docker validation and real measurements must be run on the benchmark host.

## Prerequisites

- Python 3.12 or newer on the host; standard library only.
- Docker Engine with Compose v2 and buildx for base-manifest inspection.
- Linux containers with permission to read `/proc/*/smaps_rollup` and `/sys/fs/cgroup` inside the benchmark container.
- Enough disk space for the existing release image, the mail server, the mock image, and JSONL samples.

Docker Desktop reports the Linux VM kernel/cgroup view as well as host metadata. Keep the same Docker/Desktop/VM configuration and resource allocation across compared runs. On WSL2, record its distribution and resource configuration in the report template; they are not guessed by the collector.

## Commands

Always run from the repository root.

### Offline checks

```sh
python scripts/performance/run.py check --offline
python scripts/performance/generate_fixtures.py --check
python scripts/performance/verify_fixtures.py
python -m unittest discover -s scripts/performance/tests -t scripts/performance -v
```

The tests use loopback fake HTTP servers and deterministic mocks only. They do not require Docker and never call a model provider.

### Docker/Compose validation

```sh
python scripts/performance/run.py check
```

This checks Docker and renders the merged Compose configuration. It does not start containers.

### One candidate

```sh
python scripts/performance/run.py candidate --build \
  --candidate 8 --workload ai --concurrency 5 \
  --iterations 1 --runs 5
```

Other examples:

```sh
# Mailbox, 25 clients, 100-row list requests.
python scripts/performance/run.py candidate \
  --candidate 16 --workload mailbox --concurrency 25 \
  --rows 100 --iterations 2 --runs 5

# Combined: 10 mailbox workers and 5 AI workers, summarized separately.
python scripts/performance/run.py candidate \
  --candidate 30 --workload combined --concurrency 10 \
  --ai-concurrency 5 --rows 20 --iterations 1 --runs 5
```

Preparation force-recreates only benchmark SnappyMail/mock containers, waits for readiness, samples fresh idle memory, waits 12 seconds for idle worker draining, seeds fixtures, verifies the effective FPM configuration and private/public metric boundaries, then warms and measures.

Omit `--build` after the first build to reuse the exact local image. The full matrix builds only once and checks that the application image ID does not change between candidates.

Fixtures are immutable, but inherited upstream image tags are not inherently immutable. The collector resolves their actual IDs/manifests. For a later campaign that must reuse the same mock base, set `BENCH_PYTHON_IMAGE` to the digest-pinned reference recorded in the first campaign. Rebuilding the application can also select newer packages; do not treat a rebuilt image as the same baseline unless its reviewed inputs and identity intentionally match the comparison design.

### Full matrix

```sh
python scripts/performance/run.py matrix --build
```

This runs every configured anonymous/mailbox/AI/concurrency combination for each FPM candidate. It is deliberately not a quick smoke test. Stop only this benchmark project afterwards:

```sh
python scripts/performance/run.py down
```

To discard only its synthetic volumes:

```sh
python scripts/performance/run.py down --volumes
```

### Custom output and configuration

```sh
python scripts/performance/run.py \
  --config benchmark/config.json \
  candidate --candidate 8 --workload mailbox --concurrency 1 \
  --rows 20 --iterations 2 --runs 5 \
  --output benchmark/results/my-controlled-run
```

Output must stay under `benchmark/results/`. Use a new empty path. Copy the default config before intentional changes; keep the same reviewed config for before/after comparisons. Container CPU, memory, and PID defaults in that file are reference limits, not recommendations.

## Deterministic mock provider

The mock implements:

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`, both JSON and OpenAI-compatible streaming SSE
- fixed ID, timestamp, response text, chunking, and scenario behavior
- controlled start/chunk delay and chunk size
- bounded request bodies and no request/response/auth logging

The same endpoint can exercise the existing PHP `LlmClient` and a future Rust integration. It is not a model and does not make outbound calls.

For direct local contract testing:

```sh
python scripts/performance/mock_llm.py \
  --host 127.0.0.1 --port 18080 \
  --start-delay-ms 0 --chunk-delay-ms 20 --chunk-chars 12
```

Use base URL `http://127.0.0.1:18080/v1` and one of these models:

| Model | Behavior |
| --- | --- |
| `benchmark-success` | Complete fixed draft, nonstream or SSE |
| `benchmark-reasoning` | Reasoning array/nonstream and `<think>`/SSE fixture |
| `benchmark-slow` | Complete response with configured delays |
| `benchmark-empty` | Empty content plus `[DONE]` |
| `benchmark-http-429` | HTTP 429 before streaming |
| `benchmark-malformed` | Malformed upstream JSON event |
| `benchmark-incomplete` | Partial delta without terminal `[DONE]` |
| `benchmark-provider-error` | Upstream error event |

In the isolated Compose project use `http://mock-llm:18080/v1`. Set `MOCK_START_DELAY_MS`, `MOCK_CHUNK_DELAY_MS`, and `MOCK_CHUNK_CHARS` in the runner environment to select delays/response fragmentation. The collector records these mock-specific values without dumping container environments.

## Immutable fixtures

`benchmark/fixtures/mail-fixtures.json` contains 120 INBOX and four Sent messages with fixed RFC 822 timestamps, message IDs, and synthetic bodies. This supports requested 20/100-row pages; it is not a large-mailbox fixture.

Every fixture is SHA-256-hashed in `manifest.json`, checked before seeding/measurement, and mounted read-only. To intentionally change fixtures:

```sh
python scripts/performance/generate_fixtures.py --write
python scripts/performance/verify_fixtures.py --write
```

Review both diffs. Do not regenerate fixtures between candidates being compared.

## Result layout and definitions

```text
benchmark/results/<run-id>/
  run-metadata.json
  candidate-8/
    environment.json
    preparation.json
    idle-after-readiness.json
    idle-after-drain.json
    mailbox-c10-r20/
      warmup.json
      warm-idle.json
      run-01/requests.jsonl
      run-01/metrics.jsonl
      run-01/summary.json
      ... five or more runs ...
      aggregate.json
```

- `throughput_rps`: completed HTTP/SSE operations divided by measured run wall time. Setup and dependent actions skipped after an error therefore affect throughput; skipped actions are not fabricated as requests.
- `latency_ms`: nearest-rank p50/p95/p99 over pooled non-timeout operation durations, including completed error responses. `success_latency_ms` excludes errors. Timeout durations remain in raw samples.
- `error_rate`: generic transport, HTTP, JSON-application, or SSE terminal errors divided by issued operations. Legacy HTTP 200 plus `event: error` is an error.
- `timeouts`: client deadlines, counted separately and included in errors.
- `ttfb_ms`: time to response headers for HTTP operations and the downstream stream.
- Aggregate latency pools all five runs. Aggregate run statistics report median, nearest-rank p95, and sample variance of **per-run throughput**.
- Combined runs additionally summarize `mailbox` and `ai` separately over the same wall interval.

A scenario receives `status: measured` only after all requested runs finish. Infrastructure failure creates `harness-error.json` and leaves the run incomplete. Measured application errors remain data; they are not hidden or converted into harness success.

## Environment and resource evidence

`environment.json` records, where available:

- host CPU model/physical/logical cores/RAM, kernel, architecture, and Python;
- Docker client/server, storage/cgroup drivers, cgroup version, VM kernel/OS, architecture, and memory;
- exact application container image ID, repo digests, uncompressed size, layer history, Dockerfile final base reference and registry manifest digest;
- exact image IDs/digests for SnappyMail, mock, mail, and CA services;
- mock Python base manifest digest and selected deterministic timing settings;
- CPU/memory/PID/cpuset limits and published ports;
- PHP/Nginx/Alpine package/extension versions, enabled plugin list, OPcache state, and effective FPM values;
- Git commit/dirty state plus harness/config/fixture hashes in run metadata.

Compressed registry size is reported only when an actual registry manifest is available. For a local-only image, it remains unavailable. Multi-architecture indexes are not summed as if they were a platform image.

`metrics.jsonl` samples:

- cgroup v2 `memory.current`, `memory.peak`, `memory.events`, CPU usage/throttling and PID counts;
- cgroup v1 usage/max-usage, CPU accounting/throttling and OOM counters as a fallback;
- per-process RSS, PSS, private/shared/anonymous/swap bytes from `smaps_rollup`, plus file descriptors;
- role aggregates for FPM master/workers, Nginx, Supervisord, and other processes;
- FPM accepted connections, active/idle/total processes, listen queue, max queue, max children reached, and slow requests;
- numeric worker state/timing/memory fields only. Request URI, query, script, user, and auth details are discarded.

The resource envelope reports maximum individual FPM-worker private memory and aggregate worker PSS/RSS/private memory across samples. It reports CPU/throttle/OOM deltas from the first to last available sample. `memory.peak` is cumulative for the candidate cgroup, not resettable per scenario. Unavailable probes are `null`/explicit errors, never zero.

FPM status sampling adds PHP collector processes and is not zero-overhead. Keep `sample_interval_seconds` constant across compared candidates. `docker stats` is not used as the sole instrument.

## Service objectives and comparisons

All objectives in `benchmark/config.json` default to `null`. After stakeholders define objectives, set limits deliberately and rerun the same matrix. The runner then records pass/fail against actual values; it does not propose limits from guesses.

Compare candidates only when host, Docker/VM resources, image ID, fixture manifest, workload, run count, and sampling configuration match. Inspect queueing, errors, timeouts, and mailbox latency alongside RAM. A smaller memory footprint achieved by queuing work is not an optimization.

Use `docs/performance/results-template.md` and complete `docs/performance/privacy-inventory-template.md` before publishing claims.
