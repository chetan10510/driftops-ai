import unittest

from driftops.engine import SCENARIOS, create_run


class PipelineRunTests(unittest.TestCase):
    def test_every_scenario_detects_exactly_one_failed_check(self):
        for scenario_id in SCENARIOS:
            with self.subTest(scenario=scenario_id):
                run = create_run(scenario_id)
                for _ in range(4):
                    run.tick()
                snapshot = run.snapshot()
                self.assertEqual("incident", snapshot["status"])
                self.assertEqual(1, sum(check["status"] == "fail" for check in snapshot["checks"]))
                self.assertGreater(snapshot["metrics"]["quarantined"], 0)

    def test_repair_requires_detected_incident(self):
        run = create_run("schema_drift")
        with self.assertRaises(ValueError):
            run.repair()

    def test_repair_and_replay_restores_pipeline(self):
        run = create_run("pii_leak")
        for _ in range(4):
            run.tick()
        run.repair().replay()
        snapshot = run.snapshot()
        self.assertEqual("healthy", snapshot["status"])
        self.assertEqual(0, snapshot["metrics"]["quarantined"])
        self.assertEqual(100, snapshot["metrics"]["quality_score"])
        self.assertTrue(all(check["status"] == "pass" for check in snapshot["checks"]))


if __name__ == "__main__":
    unittest.main()
