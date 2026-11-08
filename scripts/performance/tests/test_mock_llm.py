import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request

from mock_llm import MockServer

FIXTURES = Path(__file__).resolve().parents[3] / "benchmark" / "fixtures" / "llm_cases.json"


class MockProviderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = MockServer(("127.0.0.1", 0), FIXTURES, 0, 0, 8, 1024)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def post(self, model, stream=False, content="benchmark request"):
        body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}], "stream": stream}).encode()
        request = urllib.request.Request(self.url + "/v1/chat/completions", data=body, headers={"Content-Type": "application/json"})
        with self.opener.open(request, timeout=3) as response:
            return response.status, response.headers, response.read()

    def test_health_and_models(self):
        with self.opener.open(self.url + "/healthz", timeout=3) as response:
            self.assertEqual(json.loads(response.read())["provider"], "deterministic-mock")
        with self.opener.open(self.url + "/v1/models", timeout=3) as response:
            models = json.loads(response.read())["data"]
            self.assertIn("benchmark-success", {item["id"] for item in models})

    def test_nonstream_is_byte_deterministic(self):
        first = self.post("benchmark-success")
        second = self.post("benchmark-success")
        self.assertEqual(first[2], second[2])
        data = json.loads(first[2])
        self.assertEqual(data["created"], 0)
        self.assertIn("Terminbestätigung", data["choices"][0]["message"]["content"])

    def test_stream_is_openai_compatible_and_complete(self):
        status, headers, body = self.post("benchmark-success", stream=True)
        self.assertEqual(status, 200)
        self.assertIn("text/event-stream", headers["Content-Type"])
        self.assertTrue(body.endswith(b"data: [DONE]\n\n"))
        events = [json.loads(line[6:]) for line in body.decode().splitlines() if line.startswith("data: {")]
        text = "".join(item["choices"][0]["delta"]["content"] for item in events)
        fixture = json.loads(FIXTURES.read_text(encoding="utf-8"))["cases"]["benchmark-success"]["text"]
        self.assertEqual(text, fixture)

    def test_reasoning_arrays_and_failure_cases(self):
        _, _, body = self.post("benchmark-reasoning")
        content = json.loads(body)["choices"][0]["message"]["content"]
        self.assertIsInstance(content, list)
        self.assertEqual(content[0]["type"], "thinking")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post("benchmark-http-429")
        self.assertEqual(caught.exception.code, 429)
        self.assertIn(b"{not-json}", self.post("benchmark-malformed", True)[2])
        self.assertNotIn(b"[DONE]", self.post("benchmark-incomplete", True)[2])
        self.assertIn(b'"error"', self.post("benchmark-provider-error", True)[2])

    def test_unknown_model_and_oversize_are_bounded(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post("not-a-fixture")
        self.assertEqual(caught.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post("benchmark-success", content="x" * 2000)
        self.assertEqual(caught.exception.code, 413)


if __name__ == "__main__":
    unittest.main()
