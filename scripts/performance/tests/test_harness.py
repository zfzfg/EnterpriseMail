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
        self.assertIsNone(envelope["memory_peak_bytes_cumulative_high_water"])
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
        self.assertEqual(result["memory_peak_bytes_cumulative_high_water"], 250)
        self.assertEqual(result["cpu_usage_usec_delta"], 20)
        self.assertEqual(result["cpu_throttled_usec_delta"], 250)
        self.assertEqual(result["oom_kill_events_delta"], 1)
        self.assertEqual(result["fpm_individual_worker_private_bytes_max"], 70)

    def test_fpm_cumulative_deltas_and_sampled_listen_queue(self):
        def metrics(accepted, queue, max_queue, children, active, slow):
            return {
                "container": {"available": False},
                "fpm": {
                    "available": True,
                    "status": {
                        "accepted_conn": accepted,
                        "listen_queue": queue,
                        "max_listen_queue": max_queue,
                        "max_children_reached": children,
                        "max_active_processes": active,
                        "slow_requests": slow,
                        "active_processes": 1,
                        "idle_processes": 2,
                        "total_processes": 3,
                    },
                    "workers": [],
                },
            }

        result = resource_envelope([
            metrics(100, 0, 4, 1, 8, 10),
            metrics(120, 3, 4, 1, 8, 10),
            metrics(150, 0, 7, 2, 10, 12),
        ])
        self.assertEqual(result["fpm_accepted_conn_first"], 100)
        self.assertEqual(result["fpm_accepted_conn_last"], 150)
        self.assertEqual(result["fpm_accepted_conn_delta"], 50)
        self.assertEqual(result["fpm_listen_queue_max"], 3)
        self.assertEqual(result["fpm_max_listen_queue_cumulative_high_water"], 7)
        self.assertEqual(result["fpm_max_listen_queue_delta"], 3)
        self.assertEqual(result["fpm_max_children_reached_delta"], 1)
        self.assertEqual(result["fpm_max_active_processes_cumulative_high_water"], 10)
        self.assertEqual(result["fpm_max_active_processes_delta"], 2)
        self.assertEqual(result["fpm_slow_requests_delta"], 2)
        self.assertNotIn("fpm_accepted_conn_max", result)
        self.assertNotIn("fpm_max_listen_queue_max", result)

    def test_fpm_counter_reset_does_not_fabricate_delta(self):
        def sample(accepted):
            return {
                "container": {"available": False},
                "fpm": {"available": True, "status": {"accepted_conn": accepted}, "workers": []},
            }

        result = resource_envelope([sample(100), sample(20)])
        self.assertEqual(result["fpm_accepted_conn_first"], 100)
        self.assertEqual(result["fpm_accepted_conn_last"], 20)
        self.assertIsNone(result["fpm_accepted_conn_delta"])


if __name__ == "__main__":
    unittest.main()
