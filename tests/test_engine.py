import unittest

from driftops.engine import SAMPLES, SCENARIOS, create_run


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

    def test_every_sample_runs_with_its_recommended_incident(self):
        for sample_id, sample in SAMPLES.items():
            with self.subTest(sample=sample_id):
                run = create_run(sample.recommended_scenario, sample_id)
                for _ in range(4):
                    run.tick()
                snapshot = run.snapshot()
                self.assertEqual(sample_id, snapshot["sample"]["id"])
                self.assertEqual(sample.events_per_batch * 4, snapshot["metrics"]["processed"])
                self.assertEqual("incident", snapshot["status"])


if __name__ == "__main__":
    unittest.main()
