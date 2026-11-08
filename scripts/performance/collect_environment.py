#!/usr/bin/env python3
"""Capture comparison-critical host, Docker, image, and application metadata."""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import platform
import re
from typing import Any, Callable

from common import BenchError, ROOT, command, compose, sha256_bytes


def text(result: Any) -> str:
    return result.stdout.decode("utf-8", "replace").strip()


def safe_probe(callback: Callable[[], Any]) -> Any:
    try:
        return {"available": True, "value": callback()}
    except (BenchError, ValueError, json.JSONDecodeError) as exc:
        return {"available": False, "reason": str(exc)[:500]}


def json_lines(value: str) -> list[Any]:
    return [json.loads(line) for line in value.splitlines() if line.strip()]


def linux_host() -> dict[str, Any]:
    cpuinfo = Path("/proc/cpuinfo")
    meminfo = Path("/proc/meminfo")
    result: dict[str, Any] = {}
    if cpuinfo.is_file():
        lines = cpuinfo.read_text(encoding="utf-8", errors="replace").splitlines()
        models = [line.split(":", 1)[1].strip() for line in lines if line.startswith(("model name", "Model")) and ":" in line]
        if models:
            result["cpu_model"] = models[0]
        physical: set[str] = set()
        cores: set[tuple[str, str]] = set()
        current: dict[str, str] = {}
        for line in [*lines, ""]:
            if not line:
                if "physical id" in current and "core id" in current:
                    physical.add(current["physical id"])
                    cores.add((current["physical id"], current["core id"]))
                current = {}
            elif ":" in line:
                key, value = line.split(":", 1)
                current[key.strip()] = value.strip()
        if physical:
            result["physical_packages"] = len(physical)
            result["physical_cores"] = len(cores)
    if meminfo.is_file():
        match = re.search(r"^MemTotal:\s+(\d+) kB$", meminfo.read_text(), re.MULTILINE)
        if match:
            result["memory_bytes"] = int(match.group(1)) * 1024
    return result


def windows_host() -> dict[str, Any]:
    script = (
        "$cpu=@(Get-CimInstance Win32_Processor); "
        "$os=Get-CimInstance Win32_OperatingSystem; "
        "[pscustomobject]@{cpu_model=($cpu.Name -join ' | ');"
        "physical_cores=($cpu | Measure-Object NumberOfCores -Sum).Sum;"
        "physical_packages=$cpu.Count;memory_bytes=$os.TotalVisibleMemorySize*1024} | ConvertTo-Json -Compress"
    )
    result = command(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], timeout=20)
    return json.loads(text(result))


def host_metadata() -> dict[str, Any]:
    details: dict[str, Any] = {
        "platform": platform.platform(),
        "kernel": platform.release(),
        "architecture": platform.machine(),
        "python": platform.python_version(),
        "logical_cpus": os.cpu_count(),
        "cpu_model": None,
        "physical_cores": None,
        "physical_packages": None,
        "memory_bytes": None,
        # Hostname is intentionally not collected.
    }
    if Path("/proc/cpuinfo").is_file():
        details.update(linux_host())
    elif os.name == "nt":
        probe = safe_probe(windows_host)
        if probe.get("available"):
            details.update(probe["value"])
        else:
            details["windows_probe"] = probe
    return details


def docker_metadata(config: dict[str, Any], candidate: int) -> dict[str, Any]:
    version = json.loads(text(command(["docker", "version", "--format", "{{json .}}"])))
    info = json.loads(text(command(["docker", "info", "--format", "{{json .}}"])))
    selected_info = {
        key: info.get(key)
        for key in (
            "ServerVersion", "Driver", "LoggingDriver", "CgroupDriver", "CgroupVersion", "KernelVersion",
            "OperatingSystem", "OSType", "Architecture", "NCPU", "MemTotal", "DockerRootDir", "SecurityOptions",
        )
    }
    container_id = text(compose(config, ["ps", "-q", "snappymail"], candidate=candidate))
    if not container_id:
        raise BenchError("Benchmark SnappyMail container is not running")
    container = json.loads(text(command(["docker", "inspect", container_id])))[0]
    host_config = container.get("HostConfig") or {}
    limits = {
        key: host_config.get(key)
        for key in ("NanoCpus", "CpuShares", "CpuQuota", "CpuPeriod", "CpusetCpus", "Memory", "MemorySwap", "PidsLimit")
    }
    image_id = container["Image"]
    image = json.loads(text(command(["docker", "image", "inspect", image_id])))[0]
    image_metadata = {
        "id": image.get("Id"),
        "repo_tags": image.get("RepoTags") or [],
        "repo_digests": image.get("RepoDigests") or [],
        "architecture": image.get("Architecture"),
        "os": image.get("Os"),
        "uncompressed_size_bytes": image.get("Size"),
        "created": image.get("Created"),
        "history": safe_probe(lambda: json_lines(text(command(["docker", "history", "--no-trunc", "--format", "{{json .}}", image_id])))),
        "compressed_registry_artifact": {"available": False, "reason": "Local build has no registry artifact unless RepoDigests is populated"},
    }
    if image_metadata["repo_digests"]:
        image_metadata["compressed_registry_artifact"] = registry_manifest(image_metadata["repo_digests"][0])

    dockerfile = (ROOT / ".docker" / "release" / "Dockerfile").read_text(encoding="utf-8")
    bases = re.findall(r"^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+\S+)?", dockerfile, re.MULTILINE | re.IGNORECASE)
    # A final FROM scratch stage has no registry image. Record the runtime
    # stage's base instead of trying to inspect the reserved scratch name.
    base_reference = next((base for base in reversed(bases) if base.lower() != "scratch"), None)
    base = {
        "reference": base_reference,
        "final_stage_base": bases[-1] if bases else None,
        "reference_sha256_in_dockerfile": sha256_bytes(dockerfile.encode()),
    }
    if base_reference:
        local = safe_probe(lambda: json.loads(text(command(["docker", "image", "inspect", base_reference])))[0])
        if local.get("available"):
            base["local_repo_digests"] = local["value"].get("RepoDigests") or []
        base["registry_manifest"] = safe_probe(lambda: registry_manifest(base_reference))
    service_images = {}
    for service in ("snappymail", "mock-llm", "mail", "step-ca"):
        service_id = text(compose(config, ["ps", "-q", service], candidate=candidate))
        if not service_id:
            service_images[service] = {"available": False, "reason": "container not running"}
            continue
        service_container = json.loads(text(command(["docker", "inspect", service_id])))[0]
        service_image = json.loads(text(command(["docker", "image", "inspect", service_container["Image"]])))[0]
        service_images[service] = {
            "available": True,
            "container_id": service_id,
            "image_id": service_container["Image"],
            "repo_tags": service_image.get("RepoTags") or [],
            "repo_digests": service_image.get("RepoDigests") or [],
            "uncompressed_size_bytes": service_image.get("Size"),
            "architecture": service_image.get("Architecture"),
            "limits": {
                key: (service_container.get("HostConfig") or {}).get(key)
                for key in ("NanoCpus", "CpuQuota", "CpuPeriod", "CpusetCpus", "Memory", "PidsLimit")
            },
        }
        if service == "mock-llm":
            allowed = {"MOCK_START_DELAY_MS", "MOCK_CHUNK_DELAY_MS", "MOCK_CHUNK_CHARS", "MOCK_MAX_REQUEST_BYTES"}
            selected = {}
            for item in (service_container.get("Config") or {}).get("Env") or []:
                key, separator, value = item.partition("=")
                if separator and key in allowed:
                    selected[key] = value
            service_images[service]["deterministic_settings"] = selected
    mock_base_reference = os.environ.get("BENCH_PYTHON_IMAGE", "python:3.12.8-alpine3.21")
    mock_base = {
        "reference": mock_base_reference,
        "registry_manifest": safe_probe(lambda: registry_manifest(mock_base_reference)),
    }
    return {
        "version": version,
        "info": selected_info,
        "container": {
            "id": container_id,
            "started_at": (container.get("State") or {}).get("StartedAt"),
            "image_id": image_id,
            "limits": limits,
            "published_ports": (container.get("NetworkSettings") or {}).get("Ports"),
        },
        "image": image_metadata,
        "base_image": base,
        "service_images": service_images,
        "mock_base_image": mock_base,
    }


def manifest_metadata(reference: str, raw: bytes, inspection_method: str, descriptor: dict[str, Any] | None = None) -> dict[str, Any]:
    parsed = json.loads(raw)
    descriptor = descriptor or {}
    result: dict[str, Any] = {
        "reference": reference,
        "inspection_method": inspection_method,
        "manifest_sha256": descriptor.get("digest") or "sha256:" + sha256_bytes(raw),
        "manifest_media_type": descriptor.get("mediaType") or parsed.get("mediaType"),
        "manifest_kind": "index" if "manifests" in parsed else "manifest",
        "manifest_bytes": len(raw),
    }
    if descriptor.get("platform"):
        result["platform"] = descriptor["platform"]
    if "layers" in parsed:
        config_size = (parsed.get("config") or {}).get("size") or 0
        result["compressed_config_and_layers_bytes"] = config_size + sum(layer.get("size", 0) for layer in parsed["layers"])
    else:
        result["compressed_config_and_layers_bytes"] = None
        result["size_note"] = "Index requires platform-specific manifest resolution; size not inferred"
    return result


def registry_manifest(reference: str) -> dict[str, Any]:
    # Docker Desktop's CLI may not expose buildx even though `docker manifest`
    # works. Verbose output carries each exact registry manifest as base64 Raw.
    verbose = command(["docker", "manifest", "inspect", "--verbose", reference], timeout=90, check=False)
    if verbose.returncode == 0:
        entries = json.loads(verbose.stdout)
        if not isinstance(entries, list) or not entries:
            raise BenchError("docker manifest inspect returned no manifests")
        manifests = [
            manifest_metadata(
                reference,
                base64.b64decode(entry["Raw"], validate=True),
                "docker manifest inspect --verbose",
                entry.get("Descriptor") or {},
            )
            for entry in entries
        ]
        if len(manifests) == 1:
            return manifests[0]
        return {
            "reference": reference,
            "inspection_method": "docker manifest inspect --verbose",
            "manifest_kind": "index",
            "manifests": manifests,
            "compressed_config_and_layers_bytes": None,
            "size_note": "Platform-specific compressed sizes are listed per manifest; no single size is inferred",
        }

    # Retain buildx compatibility for Docker installations without manifest
    # verbose support. Only diagnostics from the successful method are stored.
    raw = command(["docker", "buildx", "imagetools", "inspect", "--raw", reference], timeout=90).stdout
    return manifest_metadata(reference, raw, "docker buildx imagetools inspect --raw")


def application_metadata(config: dict[str, Any], candidate: int) -> dict[str, Any]:
    def exec_app(args: list[str], timeout: int = 30) -> str:
        return text(compose(config, ["exec", "-T", "snappymail", *args], candidate=candidate, timeout=timeout))

    php_code = """
    $base = '/var/lib/snappymail/_data_/_default_/configs/';
    $app = parse_ini_file($base . 'application.ini', true);
    $extensions = [];
    foreach (get_loaded_extensions() as $name) { $extensions[$name] = phpversion($name) ?: null; }
    ksort($extensions);
    echo json_encode([
        'php_version' => PHP_VERSION,
        'php_sapi' => PHP_SAPI,
        'extensions' => $extensions,
        'enabled_plugins' => $app['plugins']['enabled_list'] ?? null,
        'opcache_enabled' => filter_var(ini_get('opcache.enable'), FILTER_VALIDATE_BOOL),
        'memory_limit' => ini_get('memory_limit')
    ], JSON_UNESCAPED_SLASHES);
    """
    fpm_result = compose(config, ["exec", "-T", "snappymail", "php-fpm", "-tt"], candidate=candidate)
    # php-fpm writes its configuration test to stderr, not stdout.
    fpm_raw = text(fpm_result) + "\n" + fpm_result.stderr.decode("utf-8", "replace")
    fpm: dict[str, str] = {}
    for line in fpm_raw.splitlines():
        match = re.search(r"\b(pm(?:\.max_children|\.max_requests|\.process_idle_timeout)?|pm\.status_path)\s*=\s*([^\s]+)", line)
        if match:
            fpm[match.group(1)] = match.group(2)

    def nginx_version() -> str:
        result = compose(config, ["exec", "-T", "snappymail", "nginx", "-v"], candidate=candidate)
        return text(result) or result.stderr.decode("utf-8", "replace").strip()

    return {
        "php": json.loads(exec_app(["php", "-r", php_code])),
        "nginx": safe_probe(nginx_version),
        "alpine_packages": safe_probe(lambda: sorted(exec_app(["apk", "info", "-v"]).splitlines())),
        "fpm_effective": fpm,
    }


def git_metadata() -> dict[str, Any]:
    return {
        "commit": text(command(["git", "rev-parse", "HEAD"])),
        "worktree_dirty": bool(text(command(["git", "status", "--porcelain"]))),
        # Paths and branch names are intentionally not part of metric identity.
    }


def collect(config: dict[str, Any], candidate: int) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "candidate": candidate,
        "host": safe_probe(host_metadata),
        "docker": safe_probe(lambda: docker_metadata(config, candidate)),
        "application": safe_probe(lambda: application_metadata(config, candidate)),
        "git": safe_probe(git_metadata),
        "collection_policy": "No environment dump, hostname, account data, prompts, response bodies, or provider keys",
    }


def main() -> int:
    from common import DEFAULT_CONFIG, load_config

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--candidate", type=int, choices=(8, 16, 30), required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    print(json.dumps(collect(config, args.candidate), indent=2, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
