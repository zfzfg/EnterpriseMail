import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from loadgen import execute, parse_sse_bytes


class FakeSnappyHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def json(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/?/AppData/"):
            self.json({"Auth": True, "System": {"token": "synthetic-token"}})
        else:
            self.json({"Result": True})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length))
        if self.path.startswith("/?/AiStream/"):
            body = (
                'event: start\ndata: {"model":"mock"}\n\n'
                'event: delta\ndata: {"text":"Betreff: Test\\n\\nBody"}\n\n'
                'event: done\ndata: {"subject":"Test","body":"Body","model":"mock"}\n\n'
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        action = payload.get("Action")
        if action == "MessageList":
            self.json({"Result": {"@Collection": [{"uid": 1}]}})
        else:
            self.json({"Result": True})


class LoadgenTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeSnappyHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def test_legacy_success_and_http_200_error(self):
        success = parse_sse_bytes(
            b'event: start\r\ndata: {"model":"m"}\r\n\r\n'
            b'event: delta\ndata: {"text":"Hallo"}\n\n'
            b'event: done\ndata: {"subject":"","body":"Hallo","model":"m"}\n\n'
        )
        self.assertIsNone(success.error)
        self.assertEqual(success.text, "Hallo")
        failure = parse_sse_bytes(b'event: error\ndata: {"error":"private text","code":"upstream_error"}\n\n')
        self.assertEqual(failure.error, "sse_upstream_error")
        self.assertFalse(failure.done)
        missing = parse_sse_bytes(b'event: delta\ndata: {"text":"partial"}\n\n')
        self.assertEqual(missing.error, "sse_missing_done")

    def test_mailbox_and_ai_workloads(self):
        samples, _, summary = execute(self.url, "mailbox", 2, 2, 3, rows=20)
        self.assertEqual(summary["errors"], 0)
        self.assertEqual(summary["requests"], 20)
        self.assertEqual({sample["operation"] for sample in samples}, {"Boot", "AppData", "Folders", "MessageList", "Message"})
        samples, _, summary = execute(self.url, "ai", 2, 1, 3)
        self.assertEqual(summary["errors"], 0)
        self.assertEqual(summary["requests"], 6)
        self.assertEqual(sum(sample["operation"] == "AiStream" for sample in samples), 2)

    def test_combined_reports_separate_latencies(self):
        samples, _, summary = execute(self.url, "combined", 2, 1, 3, rows=20, ai_concurrency=1)
        self.assertEqual(summary["errors"], 0)
        self.assertEqual(summary["by_workload"]["mailbox"]["requests"], 10)
        self.assertEqual(summary["by_workload"]["ai"]["requests"], 3)
        self.assertEqual(len(samples), 13)


if __name__ == "__main__":
    unittest.main()
