import math
import unittest

from common import aggregate_runs, percentile, summarize


class MetricsTest(unittest.TestCase):
    def test_nearest_rank_percentiles(self):
        self.assertEqual(percentile([4, 1, 3, 2], 0.50), 2)
        self.assertEqual(percentile([4, 1, 3, 2], 0.95), 4)
        self.assertIsNone(percentile([], 0.99))

    def test_errors_timeouts_and_http_200_application_error(self):
        samples = [
            {"duration_ms": 10, "ttfb_ms": 2, "error": None, "timed_out": False},
            {"duration_ms": 20, "ttfb_ms": 3, "error": "sse_upstream_error", "timed_out": False},
            {"duration_ms": 30, "ttfb_ms": None, "error": "timeout", "timed_out": True},
        ]
        result = summarize(samples, 3)
        self.assertEqual(result["requests"], 3)
        self.assertEqual(result["successes"], 1)
        self.assertEqual(result["timeouts"], 1)
        self.assertTrue(math.isclose(result["error_rate"], 2 / 3))
        self.assertEqual(result["latency_ms"]["p95"], 20)

    def test_five_run_aggregate_and_variance(self):
        runs = []
        samples = []
        for index in range(5):
            run_samples = [{"duration_ms": index + 1, "ttfb_ms": 1, "error": None, "timed_out": False}]
            run = summarize(run_samples, 1)
            runs.append(run)
            samples.extend(run_samples)
        with self.assertRaises(Exception):
            aggregate_runs(runs[:4], samples)
        result = aggregate_runs(runs, samples)
        self.assertEqual(result["runs"], 5)
        self.assertEqual(result["status"], "measured")
        self.assertEqual(result["run_throughput_rps"]["median"], 1)
        self.assertEqual(result["latency_ms"]["p99"], 5)


if __name__ == "__main__":
    unittest.main()
