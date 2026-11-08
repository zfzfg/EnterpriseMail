#!/usr/bin/env python3
"""Deterministic OpenAI-compatible mock; never makes an outbound connection.

The same /v1/chat/completions contract can be used by the current PHP client and
by a future Rust streamer. Request bodies, prompts, responses, and auth headers
are deliberately not logged.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

DEFAULT_FIXTURES = Path(__file__).resolve().parents[2] / "benchmark" / "fixtures" / "llm_cases.json"


def chunks(text: str, size: int) -> list[str]:
    return [text[offset : offset + size] for offset in range(0, len(text), size)]


def completion_payload(model: str, content: Any, stream: bool = False) -> dict[str, Any]:
    message_or_delta = {"content": content}
    if not stream:
        message_or_delta["role"] = "assistant"
    return {
        "id": "chatcmpl-benchmark-fixed",
        "object": "chat.completion.chunk" if stream else "chat.completion",
        "created": 0,
        "model": model,
        "choices": [
            {
                "index": 0,
                ("delta" if stream else "message"): message_or_delta,
                "finish_reason": None if stream else "stop",
            }
        ],
    }


class MockServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], fixtures: Path, start_delay_ms: int, chunk_delay_ms: int, chunk_chars: int, max_request_bytes: int):
        super().__init__(address, MockHandler)
        self.cases = json.loads(fixtures.read_text(encoding="utf-8"))["cases"]
        self.start_delay = start_delay_ms / 1000
        self.chunk_delay = chunk_delay_ms / 1000
        self.chunk_chars = chunk_chars
        self.max_request_bytes = max_request_bytes


class MockHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: MockServer

    def log_message(self, fmt: str, *args: Any) -> None:
        # BaseHTTPRequestHandler would otherwise log request paths and clients.
        return

    def send_json(self, status: int, value: Any) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self) -> None:  # noqa: N802 - stdlib HTTP handler contract
        if self.path == "/healthz":
            self.send_json(200, {"status": "ok", "provider": "deterministic-mock"})
        elif self.path == "/v1/models":
            self.send_json(200, {"object": "list", "data": [{"id": name, "object": "model", "created": 0, "owned_by": "benchmark"} for name in sorted(self.server.cases)]})
        else:
            self.send_json(404, {"error": {"message": "not found", "type": "benchmark_error"}})

    def do_POST(self) -> None:  # noqa: N802 - stdlib HTTP handler contract
        if self.path != "/v1/chat/completions":
            self.send_json(404, {"error": {"message": "not found", "type": "benchmark_error"}})
            return
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "")
        except ValueError:
            self.send_json(411, {"error": {"message": "valid Content-Length required", "type": "benchmark_error"}})
            return
        if length < 0 or length > self.server.max_request_bytes:
            self.send_json(413, {"error": {"message": "request too large", "type": "benchmark_error"}})
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
                raise ValueError("messages must be a list")
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": {"message": "invalid request", "type": "benchmark_error"}})
            return

        model = payload.get("model")
        case = self.server.cases.get(model)
        if case is None:
            self.send_json(404, {"error": {"message": "unknown benchmark model", "type": "benchmark_error"}})
            return
        behavior = case["behavior"]
        if behavior == "http_error":
            self.send_json(case["status"], {"error": {"message": case["text"], "type": "benchmark_error"}})
            return

        content: Any = case["text"]
        if behavior == "reasoning" and not payload.get("stream"):
            content = [
                {"type": "thinking", "thinking": "not part of the response"},
                {"type": "text", "text": "<think>not part of the response</think>" + case["text"]},
            ]
        response = completion_payload(model, content, bool(payload.get("stream")))
        if not payload.get("stream"):
            self.send_json(200, response)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            if self.server.start_delay:
                time.sleep(self.server.start_delay)
            if behavior == "malformed":
                self._event_raw("data: {not-json}\n\n")
            else:
                if behavior == "empty":
                    parts: list[str] = []
                elif behavior == "reasoning":
                    parts = ["<think>not part of the response</think>", *chunks(case["text"], self.server.chunk_chars)]
                else:
                    parts = chunks(case["text"], self.server.chunk_chars)
                for part in parts:
                    event = completion_payload(model, part, True)
                    self._event_raw("data: " + json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n\n")
                    if self.server.chunk_delay:
                        time.sleep(self.server.chunk_delay)
                if behavior == "provider_error":
                    self._event_raw("data: " + json.dumps({"error": {"message": case["text"]}}, separators=(",", ":")) + "\n\n")
                elif behavior != "incomplete":
                    self._event_raw("data: [DONE]\n\n")
        except (BrokenPipeError, ConnectionResetError):
            # Client cancellation is expected in cancellation benchmarks.
            return

    def _event_raw(self, data: str) -> None:
        self.wfile.write(data.encode("utf-8"))
        self.wfile.flush()


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--start-delay-ms", type=positive_int, default=int(os.environ.get("MOCK_START_DELAY_MS", "0")))
    parser.add_argument("--chunk-delay-ms", type=positive_int, default=int(os.environ.get("MOCK_CHUNK_DELAY_MS", "20")))
    parser.add_argument("--chunk-chars", type=positive_int, default=int(os.environ.get("MOCK_CHUNK_CHARS", "12")))
    parser.add_argument("--max-request-bytes", type=positive_int, default=int(os.environ.get("MOCK_MAX_REQUEST_BYTES", "65536")))
    args = parser.parse_args()
    if args.chunk_chars == 0:
        parser.error("--chunk-chars must be greater than zero")
    server = MockServer((args.host, args.port), args.fixtures, args.start_delay_ms, args.chunk_delay_ms, args.chunk_chars, args.max_request_bytes)

    def stop(signum: int, frame: Any) -> None:
        # shutdown() cannot be called from the serve_forever thread itself.
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        print(f"deterministic mock listening on {args.host}:{server.server_port}", file=sys.stderr, flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
