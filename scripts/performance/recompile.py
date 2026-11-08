#!/usr/bin/env python3
"""Recompile completed benchmark matrices and render an attributable FPM report."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Any

from collect_environment import registry_manifest, safe_probe
from common import (
    BENCHMARK,
    RESULTS,
    ROOT,
    aggregate_runs,
    atomic_write_json,
    load_json,
    sha256_file,
    summarize,
)
from run import aggregate_resources, evaluate_objectives, resource_envelope

DEFAULT_MATRICES = [RESULTS / f"fpm-{candidate}" for candidate in (8, 16, 30)]
IDENTITY_FIELDS = (
    "status", "run", "candidate", "workload", "concurrency", "ai_concurrency",
    "requested_message_rows", "iterations",
)


def jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def recompile_matrix(directory: Path) -> dict[str, Any]:
    metadata = load_json(directory / "run-metadata.json")
    if metadata.get("status") != "measured":
        raise ValueError(f"Matrix is not complete: {directory}")
    config = metadata["config"]
    candidate_dirs = sorted(path for path in directory.iterdir() if path.is_dir() and path.name.startswith("candidate-"))
    if len(candidate_dirs) != 1:
        raise ValueError(f"Expected one candidate directory in {directory}")
    candidate_dir = candidate_dirs[0]
    scenarios = {}
    for scenario_dir in sorted(path for path in candidate_dir.iterdir() if path.is_dir()):
        runs = []
        requests = []
        envelopes = []
        run_dirs = sorted(scenario_dir.glob("run-*"))
        if len(run_dirs) < 5:
            raise ValueError(f"Scenario has fewer than five runs: {scenario_dir}")
        for run_dir in run_dirs:
            previous = load_json(run_dir / "summary.json")
            request_path = run_dir / "requests.jsonl"
            metrics_path = run_dir / "metrics.jsonl"
            if previous.get("request_samples_sha256") != sha256_file(request_path):
                raise ValueError(f"Raw request digest changed: {request_path}")
            if previous.get("metrics_samples_sha256") != sha256_file(metrics_path):
                raise ValueError(f"Raw metric digest changed: {metrics_path}")
            samples = jsonl(request_path)
            metrics = jsonl(metrics_path)
            # Wall time is a measurement result, not derivable from request
            # timestamps without changing the harness's original clock scope.
            summary = summarize(samples, previous["wall_seconds"])
            summary.update({field: previous.get(field) for field in IDENTITY_FIELDS})
            summary.update(
                request_samples_sha256=sha256_file(request_path),
                metrics_samples_sha256=sha256_file(metrics_path),
                resources=resource_envelope(metrics),
            )
            if summary["workload"] == "combined":
                summary["by_workload"] = {
                    kind: summarize(
                        [sample for sample in samples if sample["workload"] == kind],
                        previous["wall_seconds"],
                    )
                    for kind in ("mailbox", "ai")
                }
            atomic_write_json(run_dir / "summary.json", summary)
            runs.append(summary)
            requests.extend(samples)
            envelopes.append(summary["resources"])

        aggregate = aggregate_runs(runs, requests)
        if runs[0]["workload"] == "combined":
            aggregate["by_workload"] = {
                kind: aggregate_runs(
                    [run["by_workload"][kind] for run in runs],
                    [sample for sample in requests if sample["workload"] == kind],
                )
                for kind in ("mailbox", "ai")
            }
        aggregate["resources"] = aggregate_resources(envelopes)
        aggregate["objectives"] = evaluate_objectives(aggregate, aggregate["resources"], config)
        aggregate["recompilation"] = {
            "schema_version": 1,
            "source": "Raw requests.jsonl and metrics.jsonl; measured wall_seconds retained from each original run summary",
            "counter_semantics": "FPM first/last/delta values are run-attributable; cumulative high-water fields are explicitly named",
        }
        atomic_write_json(scenario_dir / "aggregate.json", aggregate)
        scenarios[scenario_dir.name] = aggregate
    return {
        "candidate": int(candidate_dir.name.removeprefix("candidate-")),
        "directory": directory,
        "candidate_dir": candidate_dir,
        "config": config,
        "scenarios": scenarios,
    }


def repair_registry_metadata(matrices: list[dict[str, Any]]) -> None:
    dockerfile = (ROOT / ".docker" / "release" / "Dockerfile").read_text(encoding="utf-8")
    bases = re.findall(
        r"^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+\S+)?",
        dockerfile,
        re.MULTILINE | re.IGNORECASE,
    )
    references = {
        "base_image": next((base for base in reversed(bases) if base.lower() != "scratch"), None),
        "mock_base_image": "python:3.12.8-alpine3.21",
    }
    cache: dict[str, Any] = {}
    for matrix in matrices:
        repaired: dict[str, Any] = {
            "schema_version": 1,
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "scope": "Post-hoc registry-only repair; no benchmark was rerun and no historical local Docker metadata is invented",
            "application_image": {
                "available": False,
                "reason": "The archived environment lacks the local image RepoDigests needed to identify a registry artifact",
            },
        }
        for label, reference in references.items():
            if reference is None:
                repaired[label] = {"available": False, "reason": "No base reference found in the archived Dockerfile"}
                continue
            if reference not in cache:
                cache[reference] = safe_probe(lambda reference=reference: registry_manifest(reference))
            repaired[label] = {"reference": reference, "registry_manifest": cache[reference]}
        path = matrix["candidate_dir"] / "environment.json"
        environment = load_json(path)
        environment["registry_metadata_repair"] = repaired
        atomic_write_json(path, environment)


def number(value: float | int | None, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    return f"{value:.{digits}f}"


def mib(value: int | None) -> str:
    return number(value / 1048576 if value is not None else None)


def render_report(matrices: list[dict[str, Any]]) -> str:
    matrices = sorted(matrices, key=lambda item: item["candidate"])
    config = matrices[0]["config"]
    selected = ("anonymous-c25", "mailbox-c25-r100", "ai-c30", "combined-c10-ai5-r20")
    lines = [
        "# Attributable FPM sizing comparison",
        "",
        "## Scope and decision",
        "",
        "This report recompiles the completed 8/16/30-worker matrices from raw `requests.jsonl` and `metrics.jsonl`: 14 scenarios, five measured runs per candidate/scenario. No benchmark was rerun. "
        f"The measured container limits were {config['container_limits']['cpus']} CPUs, {config['container_limits']['memory']} memory, and {config['container_limits']['pids']} PIDs; request percentiles use the nearest rank over all pooled requests across five runs, not an average of per-run percentiles.",
        "",
        "**Retain 30 workers provisionally when pooled p95 and avoiding observed backlog are the priorities for this synthetic workload.** In AI concurrency 30, 30 workers have no sampled current listen queue and a lower pooled p95 than 8 or 16. This is not a universal sizing guarantee: 16 workers use less memory and deliver better AI-30 throughput and p99, so 16 remains preferable if those measures outweigh p95/backlog. The configured objectives contain no thresholds, so these results do not establish an SLA pass/fail.",
        "",
        "### High-concurrency evidence",
        "",
        "Memory is the maximum of each run's sampled maxima. Container current includes all container processes; FPM PSS is the sampled sum over workers. Neither is inferred from `memory.peak`.",
        "",
        "| Scenario | Workers | Pooled p95 ms | Pooled p99 ms | Throughput req/s | Errors | Container current max MiB | FPM PSS max MiB |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for scenario in selected:
        for matrix in matrices:
            item = matrix["scenarios"][scenario]
            resources = item["resources"]
            lines.append(
                f"| {scenario} | {matrix['candidate']} | {number(item['latency_ms']['p95'])} | {number(item['latency_ms']['p99'])} | "
                f"{number(item['throughput_rps'])} | {item['errors']} | {mib(resources['memory_current_bytes_max_across_runs'])} | "
                f"{mib(resources['fpm_worker_pss_bytes_max_across_runs'])} |"
            )
    ai = {matrix["candidate"]: matrix["scenarios"]["ai-c30"] for matrix in matrices}
    lines.extend([
        "",
        f"For AI-30 specifically, pooled p95 is {number(ai[30]['latency_ms']['p95'])} ms at 30 workers versus {number(ai[16]['latency_ms']['p95'])} ms at 16 and {number(ai[8]['latency_ms']['p95'])} ms at 8. "
        f"However, AI-30 p99 at 30 workers is {number(ai[30]['latency_ms']['p99'])} ms and throughput is {number(ai[30]['throughput_rps'])} req/s; 16 workers record {number(ai[16]['latency_ms']['p99'])} ms and {number(ai[16]['throughput_rps'])} req/s. Retention of 30 therefore depends on the stated p95/backlog priority and requires monitoring of tail latency and memory.",
        "",
        "## Run-attributable FPM counters",
        "",
        "`accepted_conn`, `max_children_reached`, `max_listen_queue`, `max_active_processes`, and `slow_requests` are cumulative since FPM startup. Each run summary now stores `first`, `last`, and `delta` for these fields. The tables below sum deltas over the five measured runs; they do not subtract or reinterpret FPM-startup totals as scenario values. Accepted connections include other FastCGI activity inside the sampling window, so they need not equal load-generator request counts.",
        "",
        "Current `listen_queue` remains a sampled gauge. A zero sampled maximum does not rule out transient queues between samples. A zero high-water delta means only that no new cumulative maximum was recorded during those runs; it does not mean that no queuing occurred.",
        "",
        "| Scenario | Workers | Accepted delta | Sampled current queue max | New max-listen-queue delta | Max-children-reached delta | Max-active-processes delta | Slow-request delta |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for scenario in selected:
        for matrix in matrices:
            resources = matrix["scenarios"][scenario]["resources"]
            lines.append(
                f"| {scenario} | {matrix['candidate']} | {resources['fpm_accepted_conn_delta_total']} | {resources['fpm_listen_queue_max_across_runs']} | "
                f"{resources['fpm_max_listen_queue_delta_total']} | {resources['fpm_max_children_reached_delta_total']} | "
                f"{resources['fpm_max_active_processes_delta_total']} | {resources['fpm_slow_requests_delta_total']} |"
            )
    lines.extend([
        "",
        "The clearest attributable queue event in these selected scenarios is the 30-worker mailbox-c25-r100 matrix: one new `max_listen_queue` high-water step and a sampled current queue maximum of 1. The larger cumulative queue high-water values visible at 8/16 workers cannot be assigned to AI-30 or mailbox runs merely because they appear in those runs' samples.",
        "",
        "## Complete pooled matrix",
        "",
        "OOM totals are first-to-last cgroup counter deltas summed across five runs. `n/a` would indicate unavailable data; unavailable is never converted to zero.",
        "",
        "| Scenario | Workers | Requests | Pooled p95 ms | Throughput req/s | Errors | Container current max MiB | FPM PSS max MiB | Sampled queue max | OOM delta |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ])
    scenario_names = sorted(matrices[0]["scenarios"])
    for scenario in scenario_names:
        for matrix in matrices:
            item = matrix["scenarios"][scenario]
            resources = item["resources"]
            lines.append(
                f"| {scenario} | {matrix['candidate']} | {item['requests']} | {number(item['latency_ms']['p95'])} | "
                f"{number(item['throughput_rps'])} | {item['errors']} | {mib(resources['memory_current_bytes_max_across_runs'])} | "
                f"{mib(resources['fpm_worker_pss_bytes_max_across_runs'])} | {resources['fpm_listen_queue_max_across_runs']} | "
                f"{resources['oom_kill_events_delta_total']} |"
            )
    lines.extend([
        "",
        "## Registry metadata and limitations",
        "",
        "The original environment collection aborted after an unsupported buildx invocation. The collector now uses `docker manifest inspect --verbose` first and falls back to buildx. Post-hoc registry-only results are stored under `registry_metadata_repair` in each candidate's `environment.json`; unavailable local historical Docker/application-artifact metadata remains unavailable rather than being reconstructed.",
        "",
        "The two-second sampling interval can miss short queue or memory peaks. Container `memory.peak` is retained only as an explicitly labeled cgroup-lifetime high-water field. No claim is made about unmeasured concurrency, production data, provider behavior, or other hardware. All scenarios shown had zero observed load-generator errors and zero OOM deltas, but that is evidence only for these measured windows and limits.",
        "",
        "Recompile with:",
        "",
        "```sh",
        "python scripts/performance/recompile.py --repair-registry",
        "```",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("matrices", nargs="*", type=Path, default=DEFAULT_MATRICES)
    parser.add_argument("--repair-registry", action="store_true", help="Query registry manifests and repair archived environment metadata")
    parser.add_argument("--report", type=Path, default=BENCHMARK / "fpm-sizing.md")
    args = parser.parse_args()
    matrices = [recompile_matrix(path.resolve()) for path in args.matrices]
    if args.repair_registry:
        repair_registry_metadata(matrices)
    args.report.write_text(render_report(matrices), encoding="utf-8", newline="\n")
    print(json.dumps({
        "status": "recompiled",
        "matrices": len(matrices),
        "scenarios": sum(len(matrix["scenarios"]) for matrix in matrices),
        "report": str(args.report.resolve()),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
