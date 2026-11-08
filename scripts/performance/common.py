"""Shared, standard-library-only helpers for the isolated benchmark harness."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import tempfile
import shutil
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
BENCHMARK = ROOT / "benchmark"
FIXTURES = BENCHMARK / "fixtures"
BASE_COMPOSE = ROOT / "plugins" / "ai-copilot" / "dev" / "docker-compose.yml"
OVERRIDE_COMPOSE = BENCHMARK / "docker-compose.yml"
DEFAULT_CONFIG = BENCHMARK / "config.json"
RESULTS = BENCHMARK / "results"


class BenchError(RuntimeError):
    """An infrastructure or fixture error, distinct from measured HTTP errors."""


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_config(path: Path = DEFAULT_CONFIG) -> dict[str, Any]:
    config = load_json(path)
    if config.get("schema_version") != 1:
        raise BenchError("Unsupported benchmark config schema")
    if config.get("project") != "snappymail-phase02":
        raise BenchError("Refuse to control any Compose project except isolated snappymail-phase02")
    if not isinstance(config.get("runs"), int) or config["runs"] < 5:
        raise BenchError("At least five measured runs are required")
    candidates = config.get("fpm_candidates")
    if candidates != [8, 16, 30]:
        raise BenchError("The Phase 2 candidate list must contain 8, 16, and 30 in order")
    if config.get("sample_interval_seconds", 0) <= 0:
        raise BenchError("sample_interval_seconds must be positive")
    if config.get("idle_drain_seconds", 0) < 10:
        raise BenchError("idle_drain_seconds must cover the 10 s ondemand idle timeout")
    if config.get("timeout_seconds", 0) <= 0:
        raise BenchError("timeout_seconds must be positive")
    if config.get("port", 0) not in range(1, 65536):
        raise BenchError("port must be a valid TCP port")
    for name in ("anonymous", "mailbox", "ai", "combined"):
        if name not in config:
            raise BenchError(f"Missing workload config: {name}")
    return config


def compose_environment(config: dict[str, Any], candidate: int | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env.update(
        MSYS_NO_PATHCONV="1",
        COMPOSE_PROJECT_NAME=config["project"],
        # Public deterministic fixtures do not need the host registry credentials.
        DOCKER_CONFIG=str(BENCHMARK / "docker"),
        BENCH_PORT=str(config["port"]),
        BENCH_APP_IMAGE=config["application_image"],
        # Multi-file Compose resolves relative paths from the base file.
        # Absolute slash-normalized paths also work from Windows checkouts.
        BENCH_ROOT=ROOT.as_posix(),
        BENCH_BENCHMARK=BENCHMARK.as_posix(),
        BENCH_CPUS=str(config["container_limits"]["cpus"]),
        BENCH_MEMORY=str(config["container_limits"]["memory"]),
        BENCH_PIDS=str(config["container_limits"]["pids"]),
        # Also replaces the development file's interpolation before merging.
        AI_KEY_FILE=(FIXTURES / "provider.env").as_posix(),
    )
    if candidate is not None:
        if candidate not in (8, 16, 30):
            raise BenchError("Unsupported FPM candidate")
        env["BENCH_FPM_MAX_CHILDREN"] = str(candidate)
    return env


def executable(environment_name: str, name: str) -> str:
    """Support standard PATH and Docker Desktop's Windows installation."""
    configured = os.environ.get(environment_name)
    if configured:
        return configured
    found = shutil.which(name)
    if found:
        return found
    if os.name == "nt":
        candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Docker/Docker/resources/bin" / f"{name}.exe"
        if candidate.is_file():
            return str(candidate)
    return name


def command(
    args: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout: float = 60,
    check: bool = True,
    input_bytes: bytes | None = None,
) -> subprocess.CompletedProcess[bytes]:
    """Run without a shell; callers must never include secrets in args."""
    original = args[0]
    args = list(args)
    if original == "docker":
        args[0] = executable("SNAPPY_DOCKER", "docker")
    elif original == "docker-compose":
        args[0] = executable("SNAPPY_DOCKER_COMPOSE", "docker-compose")
    environment = dict(env or os.environ)
    environment["MSYS_NO_PATHCONV"] = "1"
    if original in ("docker", "docker-compose") and Path(args[0]).is_absolute():
        # The standalone Compose binary invokes docker-credential-desktop from
        # PATH; resolving only the parent executable is not sufficient.
        bin_directory = str(Path(args[0]).parent)
        path_entries = environment.get("PATH", "").split(os.pathsep)
        if bin_directory not in path_entries:
            environment["PATH"] = bin_directory + os.pathsep + environment.get("PATH", "")
    try:
        result = subprocess.run(
            args,
            cwd=ROOT,
            env=environment,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise BenchError(f"Required executable not found: {original}") from exc
    except subprocess.TimeoutExpired as exc:
        raise BenchError(f"Command timed out after {timeout:g} s: {original} {args[1] if len(args) > 1 else ''}") from exc
    if check and result.returncode:
        # Docker/PHP diagnostics can contain paths, but this harness never passes
        # provider payloads, account passwords, or environment variables here.
        detail = result.stderr.decode("utf-8", "replace").strip()[-4000:]
        raise BenchError(f"Command failed ({result.returncode}): {original} {args[1] if len(args) > 1 else ''}\n{detail}")
    return result


def compose(
    config: dict[str, Any],
    args: list[str],
    *,
    candidate: int | None = None,
    timeout: float = 120,
    check: bool = True,
    input_bytes: bytes | None = None,
) -> subprocess.CompletedProcess[bytes]:
    standalone = shutil.which("docker-compose")
    if not standalone and os.name == "nt":
        path = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Docker/Docker/resources/bin/docker-compose.exe"
        standalone = str(path) if path.is_file() else None
    prefix = ([os.environ.get("SNAPPY_DOCKER_COMPOSE") or standalone] if os.environ.get("SNAPPY_DOCKER_COMPOSE") or standalone else ["docker", "compose"])
    return command(
        [
            *prefix,
            "--project-name",
            config["project"],
            "--file",
            str(BASE_COMPOSE),
            "--file",
            str(OVERRIDE_COMPOSE),
            *args,
        ],
        env=compose_environment(config, candidate),
        timeout=timeout,
        check=check,
        input_bytes=input_bytes,
    )


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_fixtures(fixtures: Path = FIXTURES) -> dict[str, Any]:
    manifest_path = fixtures / "manifest.json"
    manifest = load_json(manifest_path)
    if manifest.get("schema_version") != 1:
        raise BenchError("Unsupported fixture manifest schema")
    seen: set[str] = set()
    for entry in manifest.get("files", []):
        relative = entry.get("path", "")
        target = fixtures / relative
        if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts or target.is_symlink():
            raise BenchError(f"Unsafe fixture path: {relative!r}")
        if relative in seen:
            raise BenchError(f"Duplicate fixture path: {relative}")
        seen.add(relative)
        if not target.is_file():
            raise BenchError(f"Missing fixture: {relative}")
        data = target.read_bytes()
        if len(data) != entry["bytes"] or sha256_bytes(data) != entry["sha256"]:
            raise BenchError(f"Fixture digest mismatch: {relative}")
    return {
        "status": "verified",
        "manifest_sha256": sha256_file(manifest_path),
        "files": len(seen),
    }


def percentile(values: Iterable[float], quantile: float) -> float | None:
    """Nearest-rank percentile; p95 of one value is that value."""
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return None
    if not 0 < quantile <= 1:
        raise ValueError("quantile must be in (0, 1]")
    return ordered[max(0, math.ceil(quantile * len(ordered)) - 1)]


def latency_summary(samples: Iterable[dict[str, Any]], key: str = "duration_ms") -> dict[str, float | None]:
    values = [sample[key] for sample in samples if sample.get(key) is not None and not sample.get("timed_out")]
    return {label: percentile(values, q) for label, q in (("p50", 0.50), ("p95", 0.95), ("p99", 0.99))}


def summarize(samples: list[dict[str, Any]], wall_seconds: float) -> dict[str, Any]:
    if wall_seconds <= 0:
        raise BenchError("Measured duration must be positive")
    errors = [sample for sample in samples if sample.get("error")]
    timeouts = [sample for sample in samples if sample.get("timed_out")]
    return {
        "requests": len(samples),
        "successes": len(samples) - len(errors),
        "errors": len(errors),
        "error_rate": len(errors) / len(samples) if samples else None,
        "timeouts": len(timeouts),
        "throughput_rps": len(samples) / wall_seconds,
        "latency_ms": latency_summary(samples),
        "success_latency_ms": latency_summary([sample for sample in samples if not sample.get("error")]),
        "time_to_first_byte_ms": latency_summary(samples, "ttfb_ms"),
        "wall_seconds": wall_seconds,
        "error_codes": {
            code: sum(1 for sample in errors if sample.get("error") == code)
            for code in sorted({sample["error"] for sample in errors})
        },
    }


def aggregate_runs(runs: list[dict[str, Any]], samples: list[dict[str, Any]]) -> dict[str, Any]:
    if len(runs) < 5:
        raise BenchError("Aggregate requires at least five completed measured runs")
    throughputs = [run["throughput_rps"] for run in runs]
    wall = sum(run["wall_seconds"] for run in runs)
    result = summarize(samples, wall)
    result.update(
        status="measured",
        runs=len(runs),
        run_throughput_rps={
            "median": statistics.median(throughputs),
            "p95": percentile(throughputs, 0.95),
            "sample_variance": statistics.variance(throughputs),
        },
        percentile_method="nearest-rank over pooled request latencies",
        variance_method="sample variance of per-run throughput",
    )
    return result


def ensure_result_path(path: Path) -> Path:
    resolved = path.resolve()
    results = RESULTS.resolve()
    if resolved != results and results not in resolved.parents:
        raise BenchError(f"Result output must stay below {results}")
    return resolved


def atomic_write_json(path: Path, value: Any) -> None:
    ensure_result_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
    temporary.replace(path)


def append_jsonl(path: Path, values: Iterable[dict[str, Any]]) -> None:
    ensure_result_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        for value in values:
            handle.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")
