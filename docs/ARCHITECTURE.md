# Architecture

DriftOps is intentionally two runtimes with one browser-facing contract.

```mermaid
flowchart LR
  A[ADF batch APIs] --> B[ADLS Bronze]
  K[Event Hubs Kafka endpoint] --> C[Databricks Structured Streaming]
  B --> C
  C -->|valid| D[Delta Silver]
  C -->|invalid| Q[Replayable quarantine]
  D --> E[Databricks SQL Gold]
  E --> F[Customer feature API]
  E --> G[Looker semantic model]
  F --> H[Churn model]
  Q -->|after repair| C
  C -. OpenLineage .-> O[Run lineage]
  H -. MLflow .-> O
```

## Runtime Boundary

The hosted recruiter demo uses a Cloudflare Worker and D1 because its workload is interactive and low-volume. It executes the same state transitions, contract outcomes, quarantine rules, and replay gates as the Python domain model. The Azure production reference uses ADF for parameterized API ingestion and dependencies, Event Hubs' Kafka endpoint for streams, ADLS Gen2 for storage, Databricks/PySpark and Delta Lake for transformations, Databricks SQL/dbt for Gold, Azure Monitor for operations, Airflow for portable backfills, FastAPI for serving, and MLflow for model lineage.

The serverless demo does not claim distributed scale. It exists so a reviewer can exercise the failure semantics in under two minutes without cloud credentials or a local cluster.

## Guarantees

| Concern | Decision | Tradeoff |
| --- | --- | --- |
| Delivery | Event Hubs at-least-once plus idempotent `event_id` | Duplicates are detectable and recoverable; exactly-once is not promised across every sink. |
| Bad data | Quarantine per record; block affected Gold publication | Valid traffic keeps moving while downstream consumers avoid partial truth. |
| Late data | Event-time watermark and explicit backfill | Wider watermarks improve completeness but increase state and latency. |
| Schema | Versioned JSON/Avro contracts; incompatible changes fail | Producers need a compatibility window for breaking releases. |
| AI RCA | Evidence-constrained explanation after deterministic checks | AI explains an incident; it does not decide whether a contract passed. |
| Reproducibility | Run ID + dataset hash + contract + code + model version | Metadata storage adds cost but makes replay and audit possible. |

## Service ownership

| Service | Owns | Does not own |
| --- | --- | --- |
| Azure Data Factory | Batch extraction, parameters, schedules, dependencies, retries | Heavy data transformation |
| Event Hubs | Kafka-compatible event ingestion and retention | Long-term analytical storage |
| ADLS Gen2 | Bronze files, Delta tables, checkpoints, quarantine | Transformation compute |
| Azure Databricks | PySpark validation, Delta `MERGE`, Gold models, MLflow | Source scheduling policy |
| Airflow | Manual recovery, replay, cross-platform backfills | Normal hourly Azure path |
| Azure Monitor | ADF run logs, SLO alerts, operational queries | Data contract decisions |

## Failure States

`running -> incident -> repairing -> healthy`

Repair cannot run before detection. Replay cannot run before repair. A replay is successful only when quarantined count returns to zero and every contract check passes.
