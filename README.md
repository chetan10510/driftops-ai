# DriftOps AI

DriftOps is an interactive data reliability and ML operations lab. A reviewer chooses a production incident, watches customer events move through Bronze, Silver, and Gold, inspects the failed data contract and lineage, applies a repair, and replays quarantined records until the pipeline is healthy.

**Live demo:** [driftops-ai.korivichetan5.chatgpt.site](https://driftops-ai.korivichetan5.chatgpt.site)

## 90-second recruiter test

1. Choose one of six workloads, such as **Fintech payments** or **Logistics shipments**.
2. Accept its recommended incident or select a different failure mode.
3. Watch the fourth micro-batch isolate bad events while valid Bronze data remains available.
4. Inspect the failed contract, quarantined payloads, AI root cause, and run lineage.
5. Apply the repair, replay the dead-letter queue, and confirm all checks pass.

## Built-in test matrix

| Workload | Sources | Recommended incident | Events per batch |
| --- | --- | --- | ---: |
| Commerce orders | Checkout API, Postgres CDC, Refund API | Duplicate burst | 1,240 |
| SaaS subscriptions | Product events, Stripe, CRM | Schema drift | 980 |
| Fintech payments | Payment gateway, Ledger CDC, Support API | PII breach | 1,560 |
| Mobile sessions | iOS, Android, Push service | Late events | 1,840 |
| Logistics shipments | Scanners, Carrier API, GPS | Schema drift | 2,110 |
| Customer churn | Feature store, Billing, Support | Model drift | 720 |

Every workload can be combined with every incident, providing 30 recruiter-testable paths rather than one scripted walkthrough.

## Why this is not a dashboard

Every action changes server-side run state. Invalid transitions return `409`, incidents retain event-level evidence, repair is required before replay, and D1 persists hosted runs. The visual control room is a client for those rules, not a set of pre-rendered charts.

## What it demonstrates

- Versioned JSON and Avro data contracts with visible schema compatibility failures
- At-least-once stream processing, idempotent keys, event-time watermarks, and per-record quarantine
- Azure Data Factory metadata-driven ingestion with parameters, retries, dependencies, and Databricks notebook activities
- Event Hubs' Kafka endpoint, ADLS Gen2, Databricks/PySpark, and Delta Lake Bronze/Silver/Gold modeling
- Airflow recovery/backfill orchestration, source freshness, incremental SQL models, and blocking quality tests
- Run lineage across dataset, code, contract, and ML model versions
- A reproducible churn baseline logged with MLflow and drift-ready categorical features
- FastAPI/Pydantic REST contracts, a serverless Worker adapter, D1 persistence, and responsive UI
- Docker Compose, Kubernetes health/resources, and Terraform-managed Azure infrastructure
- A LookML semantic model for reliability and recovery metrics

## Architecture

The hosted demo uses a Cloudflare Worker and D1 so anyone can test it instantly. The production reference implementation maps the same transition rules to Azure Event Hubs, ADLS Gen2, Azure Databricks, Delta Lake, Data Factory, Azure Monitor, and Log Analytics.

```text
ADF / APIs -> Event Hubs -> ADLS Bronze -> Databricks PySpark -> Delta Silver/Gold
                                              |                         |
                                              +-> quarantine/replay     +-> SQL / MLflow
```

Read [Architecture](docs/ARCHITECTURE.md) for guarantees, boundaries, and tradeoffs. Read [Interview Notes](docs/INTERVIEW_NOTES.md) for the concise walkthrough and design questions.
Read [Azure Deployment](docs/AZURE_DEPLOYMENT.md) for the resource plan, free-credit options, and strict cost controls.

## Run the domain tests

```powershell
cd D:\ICUSTOMER.AI\driftops-ai
py -3 -m unittest discover -s tests -v
```

The tests are dependency-free and verify all five incidents, transition guards, quarantine behavior, and successful recovery.

## Run the API

```powershell
py -3 -m venv .venv
.venv\Scripts\pip install fastapi==0.116.1 uvicorn==0.35.0 pydantic==2.11.7
.venv\Scripts\uvicorn api.main:app --reload --port 8080
```

Or start the reference services:

```powershell
docker compose up --build
```

## API

```text
GET  /health
GET  /api/samples
GET  /api/scenarios
POST /api/runs
GET  /api/runs/{run_id}
POST /api/runs/{run_id}/tick
POST /api/runs/{run_id}/repair
POST /api/runs/{run_id}/replay
```

## Repository map

| Path | Purpose |
| --- | --- |
| `driftops/` | Dependency-free domain model and failure semantics |
| `api/` | FastAPI/Pydantic REST runtime |
| `worker/` | Hosted serverless runtime with D1 persistence |
| `streaming/` | Spark Structured Streaming validation and quarantine job |
| `azure/` | ADF pipeline, Databricks notebooks/job bundle, and Azure Monitor queries |
| `dbt/` | Staging, incremental customer features, freshness and quality tests |
| `orchestration/` | Airflow quality and lineage DAG |
| `ml/` | Reproducible scikit-learn baseline with MLflow tracking |
| `analytics/` | LookML reliability semantic model |
| `infra/` | Kubernetes and Azure Terraform deployment references |

## Responsible scope

All demo events are deterministic synthetic records. No company data, client exports, personal emails, or proprietary pipeline logic are published.
