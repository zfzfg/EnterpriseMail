#!/usr/bin/env python3
"""Prepare isolated FPM candidates and produce measured Phase 0/2 artifacts."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import threading
import time
from typing import Any
import urllib.error
import urllib.request

from common import (
    BENCHMARK,
    DEFAULT_CONFIG,
    RESULTS,
    BenchError,
    aggregate_runs,
    append_jsonl,
    atomic_write_json,
    command,
    compose,
    ensure_result_path,
    load_config,
    sha256_file,
    verify_fixtures,
)
from collect_environment import collect
from loadgen import execute
from seed import seed


def utc_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{os.getpid()}"


def harness_manifest() -> dict[str, str]:
    """Hash every executable/specification input, excluding generated results."""
    paths = []
    for path in (Path(__file__).resolve().parent).rglob("*"):
        if path.is_file() and "__pycache__" not in path.parts and path.suffix in (".py", ".php"):
            paths.append(path)
    for name in ("config.json", "docker-compose.yml", "Dockerfile.mock", "container-entrypoint.sh"):
        paths.append(BENCHMARK / name)
    paths.extend(path for path in (BENCHMARK / "fixtures").rglob("*") if path.is_file())
    return {path.relative_to(BENCHMARK.parent).as_posix(): sha256_file(path) for path in sorted(set(paths))}


def output_directory(requested: Path | None) -> Path:
    path = ensure_result_path(requested or (RESULTS / utc_id()))
    path.mkdir(parents=True, exist_ok=False)
    return path


def probe_json(config: dict[str, Any], candidate: int, script: str) -> dict[str, Any]:
    result = compose(config, ["exec", "-T", "snappymail", "php", f"/opt/performance/{script}"], candidate=candidate, check=False)
    if result.returncode:
        return {"available": False, "reason": f"collector exit {result.returncode}"}
    try:
        value = json.loads(result.stdout)
        return value if isinstance(value, dict) else {"available": False, "reason": "collector returned non-object"}
    except json.JSONDecodeError:
        return {"available": False, "reason": "collector returned invalid JSON"}


def sample(config: dict[str, Any], candidate: int) -> dict[str, Any]:
    return {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "container": probe_json(config, candidate, "container_metrics.php"),
        "fpm": probe_json(config, candidate, "fpm_status.php"),
    }


class Sampler:
    def __init__(self, config: dict[str, Any], candidate: int):
        self.config = config
        self.candidate = candidate
        self.interval = config["sample_interval_seconds"]
        self.samples: list[dict[str, Any]] = []
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        self.samples = [sample(self.config, self.candidate)]
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, name="benchmark-metrics", daemon=True)
        self.thread.start()

    def _run(self) -> None:
        while not self.stop_event.wait(self.interval):
            self.samples.append(sample(self.config, self.candidate))

    def stop(self) -> list[dict[str, Any]]:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=self.interval + 10)
        self.samples.append(sample(self.config, self.candidate))
        return self.samples


def resource_envelope(samples: list[dict[str, Any]]) -> dict[str, Any]:
    containers = [entry["container"] for entry in samples if entry.get("container", {}).get("available")]
    fpms = [entry["fpm"] for entry in samples if entry.get("fpm", {}).get("available")]
    envelope: dict[str, Any] = {
        "samples": len(samples),
        "container_samples_available": len(containers),
        "fpm_samples_available": len(fpms),
        "memory_current_bytes_max": None,
        "memory_peak_bytes_max": None,
        "fpm_worker_pss_bytes_max": None,
        "fpm_worker_rss_bytes_max": None,
        "fpm_worker_private_bytes_max": None,
        "fpm_individual_worker_private_bytes_max": None,
        "fd_count_max": None,
    }
    if containers:
        for field, source in (
            ("memory_current_bytes_max", "memory_current_bytes"),
            ("memory_peak_bytes_max", "memory_peak_bytes"),
        ):
            values = [item[source] for item in containers if item.get(source) is not None]
            envelope[field] = max(values) if values else None
        for field, role_key in (
            ("fpm_worker_pss_bytes_max", "pss_bytes"),
            ("fpm_worker_rss_bytes_max", "rss_bytes"),
            ("fpm_worker_private_bytes_max", "private_bytes"),
        ):
            values = [
                item["process"]["roles"]["fpm_worker"][role_key]
                for item in containers
                if item.get("process", {}).get("roles", {}).get("fpm_worker", {}).get(role_key) is not None
            ]
            envelope[field] = max(values) if values else None
        individual = [
            process["private_bytes"]
            for item in containers
            for process in item.get("process", {}).get("processes", [])
            if process.get("role") == "fpm_worker" and process.get("private_bytes") is not None
        ]
        envelope["fpm_individual_worker_private_bytes_max"] = max(individual) if individual else None
        fds = [
            process["fd_count"]
            for item in containers
            for process in item.get("process", {}).get("processes", [])
            if process.get("fd_count") is not None
        ]
        envelope["fd_count_max"] = max(fds) if fds else None
        first, last = containers[0]["cgroup"], containers[-1]["cgroup"]
        for field, source in (
            ("cpu_usage_usec_delta", "cpu_usage_usec"),
            ("cpu_nr_throttled_delta", "cpu_nr_throttled"),
            ("cpu_throttled_usec_delta", "cpu_throttled_usec"),
            ("oom_kill_events_delta", "oom_kill_events"),
        ):
            envelope[field] = (
                max(0, last[source] - first[source])
                if first.get(source) is not None and last.get(source) is not None
                else None
            )
        envelope["cgroup_version"] = last.get("version")
    if fpms:
        for source in ("active_processes", "idle_processes", "total_processes", "listen_queue", "max_listen_queue", "max_active_processes", "max_children_reached", "slow_requests", "accepted_conn"):
            values = [item["status"][source] for item in fpms if item.get("status", {}).get(source) is not None]
            envelope["fpm_" + source + "_max"] = max(values) if values else None
        # Ondemand worker births are not necessarily restarts, and PID reuse is
        # possible. Do not infer a restart count from request totals or PID count.
        envelope["fpm_worker_restarts_observed"] = None
        envelope["fpm_worker_restart_note"] = "Use FPM log events for restart counts; none are inferred from request totals or PID transitions"
        pids = [worker.get("pid") for item in fpms for worker in item.get("workers", []) if worker.get("pid") is not None]
        envelope["fpm_distinct_worker_pids"] = len(set(pids))
    return envelope


def wait_ready(config: dict[str, Any], timeout: float = 180) -> None:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    url = f"http://127.0.0.1:{config['port']}/healthz"
    deadline = time.monotonic() + timeout
    last_error = "not attempted"
    while time.monotonic() < deadline:
        try:
            with opener.open(url, timeout=3) as response:
                if response.status in (200, 204):
                    response.read(1024)
                    return
                last_error = f"HTTP {response.status}"
        except (urllib.error.URLError, OSError) as exc:
            last_error = type(exc).__name__
        time.sleep(1)
    raise BenchError(f"Benchmark readiness failed after {timeout:g} s ({last_error})")


def public_status_check(config: dict[str, Any], candidate: int) -> dict[str, Any]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    results = []
    for path in ("/status", "/status?full"):
        try:
            with opener.open(f"http://127.0.0.1:{config['port']}{path}", timeout=5) as response:
                status = response.status
                body = response.read(65536)
        except urllib.error.HTTPError as exc:
            status, body = exc.code, exc.read(65536)
        exposed = b"accepted conn" in body and b"idle processes" in body
        denied = status in (401, 403, 404) and not exposed
        results.append({"path": path, "http_status": status, "fpm_fields_exposed": exposed, "denied": denied})
        # Body is deliberately not persisted.
    published = compose(config, ["port", "snappymail", "9000"], candidate=candidate, check=False)
    port_9000_published = published.returncode == 0 and bool(published.stdout.strip())
    if port_9000_published or not all(item["denied"] for item in results):
        raise BenchError("Public /status is not denied or FPM port 9000 is published; refusing to benchmark")
    return {"transport": "loopback FastCGI only", "checks": results, "port_9000_published": port_9000_published}


def prepare(config: dict[str, Any], candidate: int, directory: Path, build: bool) -> dict[str, Any]:
    candidate_dir = directory / f"candidate-{candidate}"
    candidate_dir.mkdir(parents=True, exist_ok=False)
    fixtures = verify_fixtures()
    args = ["up", "-d", "--force-recreate"]
    if build:
        args.append("--build")
    compose(config, [*args, "mock-llm", "snappymail"], candidate=candidate, timeout=1200)
    wait_ready(config)
    fresh = sample(config, candidate)
    atomic_write_json(candidate_dir / "idle-after-readiness.json", fresh)
    time.sleep(config["idle_drain_seconds"])
    drained = sample(config, candidate)
    atomic_write_json(candidate_dir / "idle-after-drain.json", drained)
    seeded = seed(config, candidate)
    # Capture plugins/software after seeding, not the fresh pre-configuration state.
    environment = collect(config, candidate)
    atomic_write_json(candidate_dir / "environment.json", environment)
    effective = environment.get("application", {}).get("value", {}).get("fpm_effective", {})
    if effective.get("pm.max_children") != str(candidate):
        raise BenchError(f"Effective FPM max_children {effective.get('pm.max_children')!r} does not match candidate {candidate}")
    if effective.get("pm") != "ondemand":
        raise BenchError("Phase 2 baseline requires pm=ondemand")
    status = public_status_check(config, candidate)
    preparation = {
        "status": "prepared",
        "candidate": candidate,
        "fixtures": fixtures,
        "seed": seeded,
        "public_status": status,
        "fresh_idle_scope": "Container was force-recreated immediately before readiness sampling",
    }
    atomic_write_json(candidate_dir / "preparation.json", preparation)
    return preparation


def evaluate_objectives(summary: dict[str, Any], resources: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    objectives = config.get("objectives", {})
    checks = []
    mappings = (
        ("max_error_rate", summary.get("error_rate"), "summary.error_rate"),
        ("max_timeouts", summary.get("timeouts"), "summary.timeouts"),
        ("max_p95_ms", summary.get("latency_ms", {}).get("p95"), "summary.latency_ms.p95"),
        ("max_p99_ms", summary.get("latency_ms", {}).get("p99"), "summary.latency_ms.p99"),
        ("max_oom_kill_events", resources.get("oom_kill_events_delta"), "resources.oom_kill_events_delta"),
    )
    for name, actual, source in mappings:
        limit = objectives.get(name)
        if limit is not None:
            checks.append({"objective": name, "source": source, "limit": limit, "actual": actual, "passed": actual is not None and actual <= limit})
    return {"status": "not_configured" if not checks else "evaluated", "checks": checks}


def run_scenario(
    config: dict[str, Any],
    candidate: int,
    directory: Path,
    workload: str,
    concurrency: int,
    rows: int,
    iterations: int,
    runs: int,
    ai_concurrency: int = 0,
) -> dict[str, Any]:
    if runs < 5:
        raise BenchError("At least five measured runs are mandatory")
    label = f"{workload}-c{concurrency}"
    if workload == "mailbox":
        label += f"-r{rows}"
    if workload == "combined":
        label += f"-ai{ai_concurrency}-r{rows}"
    scenario_dir = directory / f"candidate-{candidate}" / label
    scenario_dir.mkdir(parents=True, exist_ok=False)
    base_url = f"http://127.0.0.1:{config['port']}"
    _, _, warmup = execute(
        base_url, workload, concurrency, config["warmup_iterations"], config["timeout_seconds"], rows, ai_concurrency
    )
    atomic_write_json(scenario_dir / "warmup.json", {"status": "warmup_not_measured", "summary": warmup})
    if warmup["errors"]:
        raise BenchError(f"Warmup for {label} had {warmup['errors']} errors; fix the fixture/stack before measuring")
    atomic_write_json(scenario_dir / "warm-idle.json", sample(config, candidate))

    completed = []
    all_samples = []
    envelopes = []
    for run_number in range(1, runs + 1):
        run_dir = scenario_dir / f"run-{run_number:02d}"
        run_dir.mkdir()
        sampler = Sampler(config, candidate)
        sampler.start()
        try:
            samples, wall, summary = execute(
                base_url, workload, concurrency, iterations, config["timeout_seconds"], rows, ai_concurrency
            )
        finally:
            metric_samples = sampler.stop()
        append_jsonl(run_dir / "requests.jsonl", samples)
        append_jsonl(run_dir / "metrics.jsonl", metric_samples)
        resources = resource_envelope(metric_samples)
        summary.update(
            status="measured",
            run=run_number,
            candidate=candidate,
            workload=workload,
            concurrency=concurrency,
            ai_concurrency=ai_concurrency if workload == "combined" else None,
            requested_message_rows=rows if workload in ("mailbox", "combined") else None,
            iterations=iterations,
            request_samples_sha256=sha256_file(run_dir / "requests.jsonl"),
            metrics_samples_sha256=sha256_file(run_dir / "metrics.jsonl"),
            resources=resources,
        )
        atomic_write_json(run_dir / "summary.json", summary)
        completed.append(summary)
        all_samples.extend(samples)
        envelopes.append(resources)

    aggregate = aggregate_runs(completed, all_samples)
    if workload == "combined":
        aggregate["by_workload"] = {}
        for kind in ("mailbox", "ai"):
            group_runs = [run["by_workload"][kind] for run in completed]
            group_samples = [sample for sample in all_samples if sample["workload"] == kind]
            aggregate["by_workload"][kind] = aggregate_runs(group_runs, group_samples)
    peak_values = [item["memory_peak_bytes_max"] for item in envelopes if item.get("memory_peak_bytes_max") is not None]
    private_values = [item["fpm_individual_worker_private_bytes_max"] for item in envelopes if item.get("fpm_individual_worker_private_bytes_max") is not None]
    oom_values = [item["oom_kill_events_delta"] for item in envelopes if item.get("oom_kill_events_delta") is not None]
    aggregate["resources"] = {
        "per_run": envelopes,
        "memory_peak_bytes_max": max(peak_values) if peak_values else None,
        "fpm_individual_worker_private_bytes_max": max(private_values) if private_values else None,
        "oom_kill_events_delta_total": sum(oom_values) if len(oom_values) == len(envelopes) else None,
        "oom_note": "Total is null when any run lacks an OOM counter; unavailable is never converted to zero",
    }
    aggregate["objectives"] = evaluate_objectives(aggregate, aggregate["resources"], config)
    atomic_write_json(scenario_dir / "aggregate.json", aggregate)
    return {"scenario": label, "path": str(scenario_dir.relative_to(directory)), "aggregate": aggregate}


def scenarios(config: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for concurrency in config["anonymous"]["concurrency"]:
        result.append(dict(workload="anonymous", concurrency=concurrency, rows=20, iterations=config["anonymous"]["iterations"]))
    for concurrency in config["mailbox"]["concurrency"]:
        for rows in config["mailbox"]["row_counts"]:
            result.append(dict(workload="mailbox", concurrency=concurrency, rows=rows, iterations=config["mailbox"]["iterations"]))
    for concurrency in config["ai"]["concurrency"]:
        result.append(dict(workload="ai", concurrency=concurrency, rows=20, iterations=config["ai"]["iterations"]))
    combined = config["combined"]
    result.append(
        dict(
            workload="combined",
            concurrency=combined["mail_concurrency"],
            ai_concurrency=combined["ai_concurrency"],
            rows=combined["mail_rows"],
            iterations=combined["iterations"],
        )
    )
    return result


def check(config: dict[str, Any], offline: bool) -> dict[str, Any]:
    from generate_fixtures import OUTPUT, render

    fixtures = verify_fixtures()
    if OUTPUT.read_bytes() != render():
        raise BenchError("Deterministic mail fixture generation check failed")
    result: dict[str, Any] = {"status": "ok", "offline": offline, "fixtures": fixtures, "live_provider": False}
    if not offline:
        command(["docker", "version", "--format", "{{json .Server}}"], timeout=20)
        compose(config, ["config", "--quiet"], candidate=8)
        result["docker_compose"] = "validated"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    sub = parser.add_subparsers(dest="command_name", required=True)
    check_parser = sub.add_parser("check", help="Validate config/fixtures, optionally including Docker Compose")
    check_parser.add_argument("--offline", action="store_true")
    for name in ("candidate", "matrix"):
        target = sub.add_parser(name, help="Run one scenario or the complete configured matrix")
        target.add_argument("--build", action="store_true", help="Build the application/mock images for the first candidate")
        target.add_argument("--output", type=Path)
        if name == "candidate":
            target.add_argument("--candidate", type=int, choices=(8, 16, 30), required=True)
            target.add_argument("--workload", choices=("anonymous", "mailbox", "ai", "combined"), required=True)
            target.add_argument("--concurrency", type=int, required=True)
            target.add_argument("--ai-concurrency", type=int, default=0)
            target.add_argument("--rows", type=int, default=20)
            target.add_argument("--iterations", type=int, default=1)
            target.add_argument("--runs", type=int)
    down = sub.add_parser("down", help="Stop only this isolated Compose project")
    down.add_argument("--volumes", action="store_true", help="Also delete this benchmark project's synthetic volumes")
    args = parser.parse_args()
    config = load_config(args.config)

    if args.command_name == "check":
        print(json.dumps(check(config, args.offline), indent=2, sort_keys=True))
        return 0
    if args.command_name == "down":
        compose(config, ["down", "--remove-orphans", *(["--volumes"] if args.volumes else [])], candidate=8, timeout=180)
        return 0

    directory = output_directory(args.output)
    started_at = datetime.now(timezone.utc).isoformat()
    executable_manifest = harness_manifest()
    atomic_write_json(
        directory / "run-metadata.json",
        {
            "schema_version": 1,
            "status": "in_progress",
            "config_sha256": sha256_file(args.config),
            "config": config,
            "harness_sha256": executable_manifest,
            "created_at": started_at,
            "results_policy": "No savings or regressions are inferred before measured comparisons",
        },
    )
    try:
        if args.command_name == "candidate":
            prepare(config, args.candidate, directory, args.build)
            outcome = run_scenario(
                config,
                args.candidate,
                directory,
                args.workload,
                args.concurrency,
                args.rows,
                args.iterations,
                args.runs or config["runs"],
                args.ai_concurrency,
            )
            outcomes = [outcome]
        else:
            outcomes = []
            image_ids = set()
            for index, candidate in enumerate(config["fpm_candidates"]):
                prepare(config, candidate, directory, args.build and index == 0)
                environment = json.loads((directory / f"candidate-{candidate}" / "environment.json").read_text(encoding="utf-8"))
                image_id = environment.get("docker", {}).get("value", {}).get("image", {}).get("id")
                if image_id:
                    image_ids.add(image_id)
                for scenario in scenarios(config):
                    outcomes.append(run_scenario(config, candidate, directory, runs=config["runs"], **scenario))
            if len(image_ids) > 1:
                raise BenchError("Application image ID changed within the candidate matrix")
        atomic_write_json(
            directory / "run-metadata.json",
            {
                "schema_version": 1,
                "status": "measured",
                "config_sha256": sha256_file(args.config),
                "config": config,
                "harness_sha256": executable_manifest,
                "created_at": started_at,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "completed_scenarios": len(outcomes),
                "scenario_paths": [item["path"] for item in outcomes],
            },
        )
    except Exception as exc:
        atomic_write_json(
            directory / "harness-error.json",
            {"status": "incomplete", "error_type": type(exc).__name__, "error": str(exc)[:2000]},
        )
        raise
    print(json.dumps({"status": "measured", "output": str(directory), "scenarios": len(outcomes)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
