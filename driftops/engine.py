from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any
from uuid import uuid4


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    symptom: str
    contract: str
    root_cause: str
    repair: str
    failing_check: str
    bad_field: str


SCENARIOS = {
    item.id: item
    for item in (
        Scenario("schema_drift", "Breaking schema drift", "Orders stop reaching the revenue mart", "order_total must be decimal", "Producer v3 renamed order_total to total_amount without a compatibility window.", "Map total_amount to order_total and pin contract v2.1.", "contract.order_total", "total_amount"),
        Scenario("duplicate_burst", "Duplicate event burst", "Revenue is inflated after a producer retry storm", "event_id must be unique for 24 hours", "The checkout producer retried acknowledged messages without an idempotency key.", "Deduplicate by event_id and enable producer idempotence.", "uniqueness.event_id", "event_id"),
        Scenario("late_events", "Late mobile events", "Hourly customer features are incomplete", "event_time lateness must be below 10 minutes", "Offline mobile sessions arrived beyond the configured event-time watermark.", "Widen the watermark to 30 minutes and backfill the affected window.", "freshness.event_time", "event_time"),
        Scenario("pii_leak", "PII contract breach", "Raw email values appear in an analytics topic", "customer_email must be tokenized before Silver", "A new support export bypassed the tokenization transform.", "Route support exports through the PII tokenizer and rotate exposed snapshots.", "policy.customer_email", "customer_email"),
        Scenario("model_drift", "Feature distribution drift", "Churn alerts spike without matching behavior", "prediction drift PSI must remain below 0.20", "The billing source changed null plan values to unknown, shifting plan_tier distribution.", "Normalize unknown plan values and retrain from a versioned feature snapshot.", "drift.plan_tier", "plan_tier"),
    )
}


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class PipelineRun:
    id: str
    scenario: Scenario
    status: str = "running"
    step: int = 0
    repaired: bool = False
    replayed: bool = False
    created_at: str = field(default_factory=utcnow)
    updated_at: str = field(default_factory=utcnow)
    actions: list[dict[str, str]] = field(default_factory=list)

    def tick(self) -> "PipelineRun":
        if self.status == "healthy":
            return self
        self.step = min(self.step + 1, 6)
        if self.step >= 4 and not self.repaired:
            self.status = "incident"
        self.updated_at = utcnow()
        return self

    def repair(self) -> "PipelineRun":
        if self.status != "incident":
            raise ValueError("Repair is only available after the incident is detected")
        self.repaired = True
        self.status = "repairing"
        self.actions.append({"at": utcnow(), "type": "repair", "message": self.scenario.repair})
        self.updated_at = utcnow()
        return self

    def replay(self) -> "PipelineRun":
        if not self.repaired:
            raise ValueError("Apply the repair before replaying quarantined events")
        self.replayed = True
        self.status = "healthy"
        self.actions.append({"at": utcnow(), "type": "replay", "message": "Quarantined events replayed with the repaired contract"})
        self.updated_at = utcnow()
        return self

    def snapshot(self) -> dict[str, Any]:
        incident = self.step >= 4
        processed = self.step * 1240 + (380 if self.replayed else 0)
        bad = 0 if self.replayed else (min(96, (self.step - 3) * 24) if incident else 0)
        good = max(0, processed - bad)
        quality = 100 if self.replayed else (72 if incident else 100)
        lag = 1.2 if self.replayed else (47.8 if incident else 1.8 + self.step * 0.3)
        checks = [
            {"id": "schema", "name": "Schema contract", "status": "fail" if incident and not self.replayed and self.scenario.id == "schema_drift" else "pass"},
            {"id": "uniqueness", "name": "Event uniqueness", "status": "fail" if incident and not self.replayed and self.scenario.id == "duplicate_burst" else "pass"},
            {"id": "freshness", "name": "Event freshness", "status": "fail" if incident and not self.replayed and self.scenario.id == "late_events" else "pass"},
            {"id": "privacy", "name": "PII policy", "status": "fail" if incident and not self.replayed and self.scenario.id == "pii_leak" else "pass"},
            {"id": "drift", "name": "Feature drift", "status": "fail" if incident and not self.replayed and self.scenario.id == "model_drift" else "pass"},
        ]
        stages = [
            {"id": "sources", "name": "Sources", "technology": "ADF + APIs", "count": processed, "state": "healthy"},
            {"id": "bronze", "name": "Bronze", "technology": "Event Hubs / Delta", "count": processed, "state": "healthy"},
            {"id": "silver", "name": "Silver", "technology": "Databricks PySpark", "count": good, "state": "warning" if bad else "healthy"},
            {"id": "gold", "name": "Gold", "technology": "Databricks SQL", "count": good, "state": "blocked" if bad and not self.repaired else "healthy"},
            {"id": "serve", "name": "Feature API", "technology": "FastAPI", "count": good, "state": "blocked" if bad and not self.repaired else "healthy"},
        ]
        return {
            "id": self.id,
            "status": self.status,
            "step": self.step,
            "scenario": asdict(self.scenario),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metrics": {"processed": processed, "accepted": good, "quarantined": bad, "quality_score": quality, "consumer_lag_seconds": lag, "estimated_cost_usd": round(processed * 0.0000027, 4)},
            "stages": stages,
            "checks": checks,
            "actions": self.actions,
            "incident": self._incident(incident and not self.replayed),
            "quarantine": self._quarantine(bad),
            "lineage": {"run_id": self.id, "dataset": "customer_360", "input_contract": "2.1", "code_version": "portfolio-demo", "model_version": "churn-v7", "content_hash": sha256(f"{self.id}:{self.step}".encode()).hexdigest()[:16]},
        }

    def _incident(self, active: bool) -> dict[str, Any] | None:
        if not active and not self.repaired:
            return None
        return {
            "active": active,
            "title": self.scenario.symptom,
            "root_cause": self.scenario.root_cause,
            "evidence": [f"Failed check: {self.scenario.failing_check}", f"First bad field: {self.scenario.bad_field}", "Upstream release: checkout-producer v3.4.0"],
            "repair": self.scenario.repair,
            "confidence": 94,
            "grounding": "Contract failure, lineage edge, and quarantined event samples",
        }

    def _quarantine(self, count: int) -> list[dict[str, Any]]:
        return [
            {"event_id": f"evt_{self.id[:4]}_{i:03d}", "reason": self.scenario.failing_check, "field": self.scenario.bad_field, "value": ["unexpected_string", "duplicate", "2026-09-28T03:01:12Z"][i % 3], "action": "held"}
            for i in range(min(count, 6))
        ]


def create_run(scenario_id: str) -> PipelineRun:
    if scenario_id not in SCENARIOS:
        raise ValueError(f"Unknown scenario: {scenario_id}")
    return PipelineRun(id=uuid4().hex[:12], scenario=SCENARIOS[scenario_id])
