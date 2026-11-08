#!/usr/bin/env python3
"""Concurrent HTTP workload generator using only the Python standard library.

Response bodies and prompts remain in memory and are never written to results.
Samples contain operation names, timing, status, and generic error codes only.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
import http.cookiejar
import json
import socket
import threading
import time
from typing import Any, Iterable
import urllib.error
import urllib.request

from common import BenchError, summarize

USER = "test@example.com"
PASSWORD = "test1234"
MAX_RESPONSE_BYTES = 4 * 1024 * 1024


@dataclass
class Response:
    status: int | None
    body: bytes
    sample: dict[str, Any]

    @property
    def ok(self) -> bool:
        return not self.sample.get("error")

    def json(self) -> Any:
        if not self.ok:
            raise WorkloadStop(self.sample["error"])
        try:
            return json.loads(self.body)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.sample["error"] = "invalid_json"
            raise WorkloadStop("invalid_json") from exc


class WorkloadStop(RuntimeError):
    """A measured application failure; remaining dependent actions are skipped."""


class DownstreamSse:
    """Incremental parser for SnappyMail's legacy event/data SSE contract."""

    def __init__(self) -> None:
        self.event = ""
        self.data: list[str] = []
        self.started = False
        self.done = False
        self.error: str | None = None
        self.text = ""
        self.events = 0

    def line(self, raw: bytes) -> None:
        try:
            line = raw.decode("utf-8").rstrip("\r\n")
        except UnicodeDecodeError:
            self.error = "sse_invalid_utf8"
            return
        if not line:
            self._dispatch()
        elif line.startswith(":"):
            return
        elif line.startswith("event:"):
            self.event = line[6:].strip()
        elif line.startswith("data:"):
            self.data.append(line[5:].lstrip(" "))

    def finish(self) -> None:
        self._dispatch()
        if self.error:
            return
        if not self.done:
            self.error = "sse_missing_done"

    def _dispatch(self) -> None:
        if not self.event and not self.data:
            return
        event, raw = self.event, "\n".join(self.data)
        self.event, self.data = "", []
        self.events += 1
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("event data must be an object")
        except (json.JSONDecodeError, ValueError):
            self.error = "sse_malformed_json"
            return
        if event == "start":
            if not isinstance(data.get("model"), str):
                self.error = "sse_invalid_start"
            self.started = True
        elif event == "delta":
            text = data.get("text")
            if not isinstance(text, str):
                self.error = "sse_invalid_delta"
            else:
                self.text += text
        elif event == "done":
            if not self.started or not isinstance(data.get("body"), str) or not isinstance(data.get("model"), str):
                self.error = "sse_invalid_done"
            self.done = True
        elif event == "error":
            # Deliberately retain only the stable code, never provider text.
            self.error = "sse_" + str(data.get("code") or "error")
        else:
            self.error = "sse_unknown_event"


def parse_sse_bytes(data: bytes) -> DownstreamSse:
    parser = DownstreamSse()
    for line in data.splitlines(keepends=True):
        parser.line(line)
    parser.finish()
    return parser


class Client:
    def __init__(self, base_url: str, timeout: float, workload: str, worker: int):
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout = timeout
        self.workload = workload
        self.worker = worker
        self.token = ""
        self.iteration = 0
        # Ignore proxy environment variables: benchmark traffic must stay local.
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        )

    def _sample(self, operation: str) -> dict[str, Any]:
        return {
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "workload": self.workload,
            "worker": self.worker,
            "iteration": self.iteration,
            "operation": operation,
            "status": None,
            "bytes": 0,
            "duration_ms": None,
            "ttfb_ms": None,
            "timed_out": False,
            "error": None,
        }

    def request(self, operation: str, path: str, payload: dict[str, Any] | None = None) -> Response:
        sample = self._sample(operation)
        body = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
            if self.token:
                headers["X-SM-Token"] = self.token
        request = urllib.request.Request(self.base_url + path, data=body, headers=headers)
        started = time.perf_counter()
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                sample["status"] = response.status
                sample["ttfb_ms"] = (time.perf_counter() - started) * 1000
                content = response.read(MAX_RESPONSE_BYTES + 1)
                sample["bytes"] = len(content)
                if len(content) > MAX_RESPONSE_BYTES:
                    sample["error"] = "response_too_large"
        except urllib.error.HTTPError as exc:
            sample["status"] = exc.code
            sample["error"] = f"http_{exc.code}"
            content = b""
        except (socket.timeout, TimeoutError):
            sample["timed_out"] = True
            sample["error"] = "timeout"
            content = b""
        except (urllib.error.URLError, ConnectionError, OSError) as exc:
            if isinstance(getattr(exc, "reason", None), (socket.timeout, TimeoutError)):
                sample["timed_out"] = True
                sample["error"] = "timeout"
            else:
                sample["error"] = "transport_" + type(exc).__name__
            content = b""
        finally:
            sample["duration_ms"] = (time.perf_counter() - started) * 1000
        if hasattr(self, "samples"):
            self.samples.append(sample)
        return Response(sample["status"], content, sample)

    def appdata(self) -> Response:
        return self.request("AppData", "?/AppData/0/1/")

    def post(self, action: str, params: dict[str, Any] | None = None) -> Response:
        response = self.request(action, "?/Json/&q[]=/0/", dict(params or {}, Action=action))
        if response.ok:
            data = response.json()
            if not isinstance(data, dict) or not data.get("Result"):
                code = "application_error"
                if isinstance(data, dict):
                    error = data.get("Error") or data.get("error")
                    if isinstance(error, dict) and error.get("code"):
                        code = "application_" + str(error["code"])
                response.sample["error"] = code
        return response

    def login(self) -> None:
        self.request("Boot", "")
        data_response = self.appdata()
        data = data_response.json()
        if not isinstance(data, dict) or not isinstance(data.get("System"), dict):
            raise WorkloadStop("invalid_appdata")
        self.token = str(data["System"].get("token") or "")
        if not self.token:
            raise WorkloadStop("missing_csrf")
        if not data.get("Auth"):
            login = self.post("Login", {"Email": USER, "Password": PASSWORD})
            data = login.json()
            # Login returns a result but AppData is the authoritative session state.
            refreshed = self.appdata().json()
            self.token = str(refreshed.get("System", {}).get("token") or self.token)
            if not refreshed.get("Auth"):
                raise WorkloadStop("login_not_authenticated")

    def save_consent(self) -> None:
        self.login()
        response = self.post(
            "PluginAiSaveSettings",
            {"settings": {"enabled": True, "features": {"draft": True}, "notice_ack": True}},
        )
        data = response.json()
        result = data.get("Result") or {}
        if not result.get("saved"):
            raise BenchError("Could not seed synthetic user's mock-provider consent")

    def mailbox_iteration(self, rows: int) -> list[dict[str, Any]]:
        before = len(getattr(self, "samples", []))
        self.post("Folders")
        listing = self.post(
            "MessageList",
            {"folder": "INBOX", "limit": rows, "offset": 0, "search": "", "sort": "", "useThreads": "0"},
        ).json()
        collection = (listing.get("Result") or {}).get("@Collection") or []
        if not collection:
            raise BenchError("Immutable INBOX fixture is empty")
        uid = int(collection[0]["uid"])
        self.post("Message", {"folder": "INBOX", "uid": uid})
        return self.samples[before:]

    def stream(self, model_instruction: str = "Write a short deterministic appointment confirmation.") -> dict[str, Any]:
        sample = self._sample("AiStream")
        payload = {
            "mode": "new",
            "tone": "professional",
            "instruction": model_instruction,
            "current": "",
            "wantSubject": True,
            "folder": "",
            "uids": [],
            "sent": "Sent",
        }
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + "?/AiStream/",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "X-SM-Token": self.token,
                "Sec-Fetch-Site": "same-origin",
            },
        )
        started = time.perf_counter()
        parser = DownstreamSse()
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                sample["status"] = response.status
                sample["ttfb_ms"] = (time.perf_counter() - started) * 1000
                while not parser.error and not parser.done:
                    line = response.readline()
                    if not line:
                        break
                    sample["bytes"] += len(line)
                    if sample["bytes"] > MAX_RESPONSE_BYTES:
                        parser.error = "response_too_large"
                        break
                    parser.line(line)
                parser.finish()
                sample["error"] = parser.error
        except urllib.error.HTTPError as exc:
            sample["status"] = exc.code
            sample["error"] = f"http_{exc.code}"
        except (socket.timeout, TimeoutError):
            sample["timed_out"] = True
            sample["error"] = "timeout"
        except (urllib.error.URLError, ConnectionError, OSError) as exc:
            if isinstance(getattr(exc, "reason", None), (socket.timeout, TimeoutError)):
                sample["timed_out"] = True
                sample["error"] = "timeout"
            else:
                sample["error"] = "transport_" + type(exc).__name__
        finally:
            sample["duration_ms"] = (time.perf_counter() - started) * 1000
        return sample


def execute(
    base_url: str,
    workload: str,
    concurrency: int,
    iterations: int,
    timeout: float,
    rows: int = 20,
    ai_concurrency: int = 0,
) -> tuple[list[dict[str, Any]], float, dict[str, Any]]:
    """Execute one measured run; transport/application failures become samples."""
    if concurrency < 1 or iterations < 1 or rows < 1:
        raise BenchError("Concurrency, iterations, and rows must be positive")
    if workload == "combined" and ai_concurrency < 1:
        raise BenchError("Combined workload requires AI concurrency")
    total_workers = concurrency + (ai_concurrency if workload == "combined" else 0)
    barrier = threading.Barrier(total_workers)

    def worker(worker_id: int, kind: str) -> list[dict[str, Any]]:
        client = Client(base_url, timeout, kind, worker_id)
        client.samples = []
        barrier.wait(timeout=timeout)
        for iteration in range(iterations):
            client.iteration = iteration
            try:
                if kind != "anonymous":
                    client.login()
                if kind == "anonymous":
                    client.request("Boot", "")
                    client.appdata()
                elif kind == "mailbox":
                    client.mailbox_iteration(rows)
                elif kind == "ai":
                    client.samples.append(client.stream())
                else:
                    raise BenchError(f"Unknown workload kind: {kind}")
            except WorkloadStop:
                # The failed operation is already represented by an error sample.
                # Do not issue dependent mailbox actions with missing state.
                break
        return client.samples

    jobs: list[tuple[int, str]] = []
    if workload == "combined":
        jobs = [(index, "mailbox") for index in range(concurrency)] + [
            (index, "ai") for index in range(ai_concurrency)
        ]
    else:
        jobs = [(index, workload) for index in range(concurrency)]
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=total_workers) as pool:
        futures = [pool.submit(worker, worker_id, kind) for worker_id, kind in jobs]
        samples = [sample for future in futures for sample in future.result()]
    wall = time.perf_counter() - started
    if not samples:
        raise BenchError("Workload produced no requests; refusing an empty measured run")
    summary = summarize(samples, wall)
    if workload == "combined":
        summary["by_workload"] = {}
        for kind in ("mailbox", "ai"):
            selected = [sample for sample in samples if sample["workload"] == kind]
            summary["by_workload"][kind] = summarize(selected, wall)
    return samples, wall, summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:18888")
    parser.add_argument("--workload", choices=("anonymous", "mailbox", "ai", "combined"), required=True)
    parser.add_argument("--concurrency", type=int, required=True)
    parser.add_argument("--ai-concurrency", type=int, default=0)
    parser.add_argument("--iterations", type=int, default=1)
    parser.add_argument("--rows", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--require-success", action="store_true")
    args = parser.parse_args()
    samples, _, summary = execute(
        args.url, args.workload, args.concurrency, args.iterations, args.timeout, args.rows, args.ai_concurrency
    )
    # Standalone mode prints aggregate metrics only, never response content.
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 1 if args.require_success and summary["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
