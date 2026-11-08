# Attributable FPM sizing comparison

## Scope and decision

This report recompiles the completed 8/16/30-worker matrices from raw `requests.jsonl` and `metrics.jsonl`: 14 scenarios, five measured runs per candidate/scenario. No benchmark was rerun. The measured container limits were 2.0 CPUs, 1g memory, and 512 PIDs; request percentiles use the nearest rank over all pooled requests across five runs, not an average of per-run percentiles.

**Retain 30 workers provisionally when pooled p95 and avoiding observed backlog are the priorities for this synthetic workload.** In AI concurrency 30, 30 workers have no sampled current listen queue and a lower pooled p95 than 8 or 16. This is not a universal sizing guarantee: 16 workers use less memory and deliver better AI-30 throughput and p99, so 16 remains preferable if those measures outweigh p95/backlog. The configured objectives contain no thresholds, so these results do not establish an SLA pass/fail.

### High-concurrency evidence

Memory is the maximum of each run's sampled maxima. Container current includes all container processes; FPM PSS is the sampled sum over workers. Neither is inferred from `memory.peak`.

| Scenario | Workers | Pooled p95 ms | Pooled p99 ms | Throughput req/s | Errors | Container current max MiB | FPM PSS max MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| anonymous-c25 | 8 | 261.92 | 285.53 | 100.81 | 0 | 90.55 | 36.98 |
| anonymous-c25 | 16 | 235.44 | 239.43 | 120.73 | 0 | 105.35 | 50.97 |
| anonymous-c25 | 30 | 199.28 | 272.44 | 127.01 | 0 | 122.18 | 65.11 |
| mailbox-c25-r100 | 8 | 610.56 | 670.70 | 56.09 | 0 | 114.77 | 58.67 |
| mailbox-c25-r100 | 16 | 503.54 | 554.23 | 70.53 | 0 | 147.84 | 90.77 |
| mailbox-c25-r100 | 30 | 518.55 | 613.77 | 72.59 | 0 | 190.23 | 135.62 |
| ai-c30 | 8 | 1067.24 | 1231.99 | 50.55 | 0 | 113.56 | 55.82 |
| ai-c30 | 16 | 688.17 | 703.93 | 67.92 | 0 | 145.05 | 88.01 |
| ai-c30 | 30 | 520.12 | 1710.90 | 54.09 | 0 | 198.70 | 137.21 |
| combined-c10-ai5-r20 | 8 | 412.75 | 489.05 | 56.55 | 0 | 113.08 | 55.82 |
| combined-c10-ai5-r20 | 16 | 366.49 | 407.89 | 70.57 | 0 | 144.92 | 87.69 |
| combined-c10-ai5-r20 | 30 | 365.29 | 414.20 | 73.14 | 0 | 199.54 | 138.63 |

For AI-30 specifically, pooled p95 is 520.12 ms at 30 workers versus 688.17 ms at 16 and 1067.24 ms at 8. However, AI-30 p99 at 30 workers is 1710.90 ms and throughput is 54.09 req/s; 16 workers record 703.93 ms and 67.92 req/s. Retention of 30 therefore depends on the stated p95/backlog priority and requires monitoring of tail latency and memory.

## Run-attributable FPM counters

`accepted_conn`, `max_children_reached`, `max_listen_queue`, `max_active_processes`, and `slow_requests` are cumulative since FPM startup. Each run summary now stores `first`, `last`, and `delta` for these fields. The tables below sum deltas over the five measured runs; they do not subtract or reinterpret FPM-startup totals as scenario values. Accepted connections include other FastCGI activity inside the sampling window, so they need not equal load-generator request counts.

Current `listen_queue` remains a sampled gauge. A zero sampled maximum does not rule out transient queues between samples. A zero high-water delta means only that no new cumulative maximum was recorded during those runs; it does not mean that no queuing occurred.

| Scenario | Workers | Accepted delta | Sampled current queue max | New max-listen-queue delta | Max-children-reached delta | Max-active-processes delta | Slow-request delta |
|---|---:|---:|---:|---:|---:|---:|---:|
| anonymous-c25 | 8 | 505 | 17 | 0 | 0 | 0 | 0 |
| anonymous-c25 | 16 | 505 | 9 | 9 | 0 | 6 | 0 |
| anonymous-c25 | 30 | 505 | 0 | 0 | 0 | 7 | 0 |
| mailbox-c25-r100 | 8 | 1516 | 18 | 0 | 0 | 0 | 0 |
| mailbox-c25-r100 | 16 | 1511 | 9 | 0 | 0 | 0 | 0 |
| mailbox-c25-r100 | 30 | 1511 | 1 | 1 | 0 | 0 | 0 |
| ai-c30 | 8 | 760 | 22 | 0 | 0 | 0 | 0 |
| ai-c30 | 16 | 761 | 14 | 0 | 0 | 0 | 0 |
| ai-c30 | 30 | 760 | 0 | 0 | 0 | 0 | 0 |
| combined-c10-ai5-r20 | 8 | 480 | 7 | 0 | 0 | 0 | 0 |
| combined-c10-ai5-r20 | 16 | 480 | 0 | 0 | 0 | 0 | 0 |
| combined-c10-ai5-r20 | 30 | 480 | 1 | 0 | 0 | 0 | 0 |

The clearest attributable queue event in these selected scenarios is the 30-worker mailbox-c25-r100 matrix: one new `max_listen_queue` high-water step and a sampled current queue maximum of 1. The larger cumulative queue high-water values visible at 8/16 workers cannot be assigned to AI-30 or mailbox runs merely because they appear in those runs' samples.

## Complete pooled matrix

OOM totals are first-to-last cgroup counter deltas summed across five runs. `n/a` would indicate unavailable data; unavailable is never converted to zero.

| Scenario | Workers | Requests | Pooled p95 ms | Throughput req/s | Errors | Container current max MiB | FPM PSS max MiB | Sampled queue max | OOM delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ai-c1 | 8 | 25 | 342.03 | 6.17 | 0 | 111.33 | 55.50 | 0 | 0 |
| ai-c1 | 16 | 25 | 343.62 | 6.03 | 0 | 142.98 | 86.93 | 0 | 0 |
| ai-c1 | 30 | 25 | 344.04 | 5.95 | 0 | 187.01 | 128.30 | 0 | 0 |
| ai-c10 | 8 | 250 | 417.71 | 45.21 | 0 | 112.10 | 55.68 | 2 | 0 |
| ai-c10 | 16 | 250 | 336.71 | 55.39 | 0 | 144.30 | 87.84 | 0 | 0 |
| ai-c10 | 30 | 250 | 354.69 | 53.13 | 0 | 188.12 | 129.32 | 0 | 0 |
| ai-c30 | 8 | 750 | 1067.24 | 50.55 | 0 | 113.56 | 55.82 | 22 | 0 |
| ai-c30 | 16 | 750 | 688.17 | 67.92 | 0 | 145.05 | 88.01 | 14 | 0 |
| ai-c30 | 30 | 750 | 520.12 | 54.09 | 0 | 198.70 | 137.21 | 0 | 0 |
| ai-c5 | 8 | 125 | 326.15 | 33.92 | 0 | 111.54 | 55.61 | 0 | 0 |
| ai-c5 | 16 | 125 | 326.80 | 34.15 | 0 | 143.51 | 87.77 | 0 | 0 |
| ai-c5 | 30 | 125 | 331.86 | 34.16 | 0 | 190.66 | 128.81 | 0 | 0 |
| anonymous-c1 | 8 | 20 | 96.23 | 11.72 | 0 | 78.80 | 21.25 | 0 | 0 |
| anonymous-c1 | 16 | 20 | 99.13 | 11.74 | 0 | 77.62 | 16.65 | 0 | 0 |
| anonymous-c1 | 30 | 20 | 96.75 | 11.83 | 0 | 77.42 | 16.04 | 0 | 0 |
| anonymous-c10 | 8 | 200 | 142.18 | 90.42 | 0 | 90.84 | 36.93 | 2 | 0 |
| anonymous-c10 | 16 | 200 | 91.59 | 99.21 | 0 | 94.42 | 40.75 | 0 | 0 |
| anonymous-c10 | 30 | 200 | 94.01 | 100.41 | 0 | 94.52 | 40.71 | 0 | 0 |
| anonymous-c25 | 8 | 500 | 261.92 | 100.81 | 0 | 90.55 | 36.98 | 17 | 0 |
| anonymous-c25 | 16 | 500 | 235.44 | 120.73 | 0 | 105.35 | 50.97 | 9 | 0 |
| anonymous-c25 | 30 | 500 | 199.28 | 127.01 | 0 | 122.18 | 65.11 | 0 | 0 |
| combined-c10-ai5-r20 | 8 | 475 | 412.75 | 56.55 | 0 | 113.08 | 55.82 | 7 | 0 |
| combined-c10-ai5-r20 | 16 | 475 | 366.49 | 70.57 | 0 | 144.92 | 87.69 | 0 | 0 |
| combined-c10-ai5-r20 | 30 | 475 | 365.29 | 73.14 | 0 | 199.54 | 138.63 | 1 | 0 |
| mailbox-c1-r100 | 8 | 60 | 196.29 | 7.15 | 0 | 105.79 | 53.38 | 0 | 0 |
| mailbox-c1-r100 | 16 | 60 | 201.36 | 7.01 | 0 | 134.20 | 80.77 | 0 | 0 |
| mailbox-c1-r100 | 30 | 60 | 232.23 | 6.82 | 0 | 157.83 | 103.45 | 0 | 0 |
| mailbox-c1-r20 | 8 | 60 | 219.59 | 6.74 | 0 | 100.43 | 46.85 | 0 | 0 |
| mailbox-c1-r20 | 16 | 60 | 245.92 | 6.18 | 0 | 122.19 | 69.04 | 1 | 0 |
| mailbox-c1-r20 | 30 | 60 | 294.82 | 5.83 | 0 | 143.23 | 88.44 | 0 | 0 |
| mailbox-c10-r100 | 8 | 600 | 257.97 | 52.35 | 0 | 109.37 | 56.01 | 2 | 0 |
| mailbox-c10-r100 | 16 | 600 | 224.76 | 62.21 | 0 | 139.95 | 86.34 | 0 | 0 |
| mailbox-c10-r100 | 30 | 600 | 224.40 | 61.25 | 0 | 174.43 | 118.19 | 0 | 0 |
| mailbox-c10-r20 | 8 | 600 | 254.75 | 54.13 | 0 | 107.25 | 54.12 | 2 | 0 |
| mailbox-c10-r20 | 16 | 600 | 213.13 | 62.40 | 0 | 135.85 | 81.62 | 0 | 0 |
| mailbox-c10-r20 | 30 | 600 | 212.37 | 60.98 | 0 | 163.40 | 107.10 | 0 | 0 |
| mailbox-c25-r100 | 8 | 1500 | 610.56 | 56.09 | 0 | 114.77 | 58.67 | 18 | 0 |
| mailbox-c25-r100 | 16 | 1500 | 503.54 | 70.53 | 0 | 147.84 | 90.77 | 9 | 0 |
| mailbox-c25-r100 | 30 | 1500 | 518.55 | 72.59 | 0 | 190.23 | 135.62 | 1 | 0 |
| mailbox-c25-r20 | 8 | 1500 | 585.18 | 58.09 | 0 | 111.07 | 56.12 | 18 | 0 |
| mailbox-c25-r20 | 16 | 1500 | 463.13 | 73.00 | 0 | 144.59 | 88.95 | 9 | 0 |
| mailbox-c25-r20 | 30 | 1500 | 427.79 | 77.11 | 0 | 181.22 | 123.41 | 0 | 0 |

## Registry metadata and limitations

The original environment collection aborted after an unsupported buildx invocation. The collector now uses `docker manifest inspect --verbose` first and falls back to buildx. Post-hoc registry-only results are stored under `registry_metadata_repair` in each candidate's `environment.json`; unavailable local historical Docker/application-artifact metadata remains unavailable rather than being reconstructed.

The two-second sampling interval can miss short queue or memory peaks. Container `memory.peak` is retained only as an explicitly labeled cgroup-lifetime high-water field. No claim is made about unmeasured concurrency, production data, provider behavior, or other hardware. All scenarios shown had zero observed load-generator errors and zero OOM deltas, but that is evidence only for these measured windows and limits.

Recompile with:

```sh
python scripts/performance/recompile.py --repair-registry
```
