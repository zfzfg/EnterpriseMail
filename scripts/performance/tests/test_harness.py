from pathlib import Path
import unittest

from common import DEFAULT_CONFIG, load_config, verify_fixtures
from generate_fixtures import OUTPUT, render
from run import resource_envelope, scenarios


class HarnessTest(unittest.TestCase):
    def test_config_and_immutable_fixtures(self):
        config = load_config()
        self.assertGreaterEqual(config["runs"], 5)
        self.assertEqual(config["fpm_candidates"], [8, 16, 30])
        self.assertEqual(verify_fixtures()["status"], "verified")
        self.assertEqual(OUTPUT.read_bytes(), render())
        self.assertIsNone(config["objectives"]["max_error_rate"])

    def test_default_matrix_has_required_workloads(self):
        config = load_config(DEFAULT_CONFIG)
        matrix = scenarios(config)
        self.assertEqual({item["workload"] for item in matrix}, {"anonymous", "mailbox", "ai", "combined"})
        self.assertIn(100, config["mailbox"]["row_counts"])
        self.assertIn(30, config["ai"]["concurrency"])

    def test_unavailable_resources_are_not_zero(self):
        envelope = resource_envelope([{"container": {"available": False}, "fpm": {"available": False}}])
        self.assertEqual(envelope["samples"], 1)
        self.assertIsNone(envelope["memory_peak_bytes_max"])
        self.assertIsNone(envelope.get("oom_kill_events_delta"))

    def test_resource_deltas_and_private_high_water(self):
        metric = {
            "available": True,
            "memory_current_bytes": 100,
            "memory_peak_bytes": 200,
            "cgroup": {"version": 2, "cpu_usage_usec": 10, "cpu_nr_throttled": 1, "cpu_throttled_usec": 100, "oom_kill_events": 0},
            "process": {
                "roles": {"fpm_worker": {"pss_bytes": 50, "rss_bytes": 60, "private_bytes": 40}},
                "processes": [{"role": "fpm_worker", "private_bytes": 40, "fd_count": 8}],
            },
        }
        later = {
            **metric,
            "memory_current_bytes": 150,
            "memory_peak_bytes": 250,
            "cgroup": {"version": 2, "cpu_usage_usec": 30, "cpu_nr_throttled": 3, "cpu_throttled_usec": 350, "oom_kill_events": 1},
            "process": {
                "roles": {"fpm_worker": {"pss_bytes": 80, "rss_bytes": 90, "private_bytes": 70}},
                "processes": [{"role": "fpm_worker", "private_bytes": 70, "fd_count": 12}],
            },
        }
        result = resource_envelope([
            {"container": metric, "fpm": {"available": False}},
            {"container": later, "fpm": {"available": False}},
        ])
        self.assertEqual(result["memory_peak_bytes_max"], 250)
        self.assertEqual(result["cpu_usage_usec_delta"], 20)
        self.assertEqual(result["cpu_throttled_usec_delta"], 250)
        self.assertEqual(result["oom_kill_events_delta"], 1)
        self.assertEqual(result["fpm_individual_worker_private_bytes_max"], 70)


if __name__ == "__main__":
    unittest.main()
