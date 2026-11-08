# Phase 0/2 measured comparison report template

**Status: NOT MEASURED until every field is filled from a completed result directory. Do not convert estimates into results.**

## Run identity

- Result directory: `NOT MEASURED`
- Report author/date: `NOT MEASURED`
- Git commit and harness manifest: `NOT MEASURED`
- Application image ID / repo digest: `NOT MEASURED`
- Final base-image reference / platform manifest digest: `NOT MEASURED`
- Fixture manifest digest: `NOT MEASURED`
- Config digest and mock delay/chunk settings: `NOT MEASURED`

## Reference environment

| Field | Observed value |
| --- | --- |
| Host CPU / physical / logical cores | NOT MEASURED |
| Host RAM | NOT MEASURED |
| Host OS / kernel / architecture | NOT MEASURED |
| Docker client/server, storage and cgroup drivers | NOT MEASURED |
| Docker Desktop/WSL2/VM configuration, if applicable | NOT MEASURED |
| Cgroup version | NOT MEASURED |
| Container CPU / memory / PID / cpuset limits | NOT MEASURED |
| PHP / Nginx / extension and package versions | NOT MEASURED |
| Enabled plugins | NOT MEASURED |
| Mailbox and fixture distribution | 120 INBOX + 4 Sent synthetic fixtures; runtime seed NOT MEASURED here |
| Browser/version/viewport | NOT COVERED BY THIS HARNESS |

## Scenario comparison

Duplicate rows for every candidate/workload/concurrency/row-count combination. Use five or more completed runs after warm-up.

| FPM | Workload | Clients | Rows | Runs | Throughput median / p95 / variance | p50 / p95 / p99 ms | Errors | Timeouts | Result |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | --- |
| 8 | NOT MEASURED | — | — | 0 | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| 16 | NOT MEASURED | — | — | 0 | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| 30 | NOT MEASURED | — | — | 0 | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |

Combined load must have separate mailbox and AI latency/error rows.

## Memory, CPU, queue, and correctness

| FPM | Fresh/drained/warm idle | Peak cgroup memory | Max individual worker private bytes | Worker PSS/RSS | CPU/throttle delta | OOM kills | Max queue / max children reached |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| 16 | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| 30 | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |

Record `memory.peak` as candidate-cgroup cumulative, not per-scenario. Mark unsupported metrics unavailable; do not enter zero.

## Objectives and decision

- Agreed service objectives and their source: `NOT DEFINED`
- Objective pass/fail evidence: `NOT MEASURED`
- Public `/status` and port 9000 checks: `NOT MEASURED`
- Functional regressions / feature matrix: `NOT COVERED BY DEFAULT WORKLOADS`
- Result limitations and unmeasured environments: `TO BE DOCUMENTED`
- Decision: `NO DECISION BEFORE MEASUREMENT`

No recommendation should select a lower FPM limit solely because RAM falls. Queueing, throughput, tail latency, errors, OOM behavior, and combined mailbox latency must remain acceptable under an agreed objective.
