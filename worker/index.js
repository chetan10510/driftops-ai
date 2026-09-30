const RUNS = new Map();

const SCENARIOS = {
  schema_drift: {
    id: "schema_drift", name: "Breaking schema drift", risk: "Revenue mart outage", icon: "braces",
    symptom: "Orders stop reaching the revenue mart", contract: "order_total must be decimal",
    root_cause: "Producer v3 renamed order_total to total_amount without a compatibility window.",
    repair: "Map total_amount to order_total and pin contract v2.1.", failing_check: "contract.order_total", bad_field: "total_amount",
  },
  duplicate_burst: {
    id: "duplicate_burst", name: "Duplicate event burst", risk: "Inflated revenue", icon: "copy",
    symptom: "Revenue is inflated after a producer retry storm", contract: "event_id must be unique for 24 hours",
    root_cause: "The checkout producer retried acknowledged messages without an idempotency key.",
    repair: "Deduplicate by event_id and enable producer idempotence.", failing_check: "uniqueness.event_id", bad_field: "event_id",
  },
  late_events: {
    id: "late_events", name: "Late mobile events", risk: "Stale customer features", icon: "clock",
    symptom: "Hourly customer features are incomplete", contract: "event-time lateness must be below 10 minutes",
    root_cause: "Offline mobile sessions arrived beyond the configured event-time watermark.",
    repair: "Widen the watermark to 30 minutes and backfill the affected window.", failing_check: "freshness.event_time", bad_field: "event_time",
  },
  pii_leak: {
    id: "pii_leak", name: "PII contract breach", risk: "Privacy exposure", icon: "shield-alert",
    symptom: "Raw email values appear in an analytics topic", contract: "customer_email must be tokenized before Silver",
    root_cause: "A new support export bypassed the tokenization transform.",
    repair: "Route support exports through the PII tokenizer and rotate exposed snapshots.", failing_check: "policy.customer_email", bad_field: "customer_email",
  },
  model_drift: {
    id: "model_drift", name: "Feature distribution drift", risk: "Unreliable churn alerts", icon: "activity",
    symptom: "Churn alerts spike without matching behavior", contract: "prediction drift PSI must remain below 0.20",
    root_cause: "The billing source changed null plan values to unknown, shifting plan_tier distribution.",
    repair: "Normalize unknown plan values and retrain from a versioned feature snapshot.", failing_check: "drift.plan_tier", bad_field: "plan_tier",
  },
};

const SAMPLES = {
  commerce_orders: { id: "commerce_orders", name: "Commerce orders", industry: "E-commerce", description: "Checkout, catalog, and refund events feeding revenue and customer marts.", sources: ["Checkout API", "Postgres CDC", "Refund API"], events_per_batch: 1240, recommended_scenario: "duplicate_burst", icon: "shopping-cart" },
  saas_subscriptions: { id: "saas_subscriptions", name: "SaaS subscriptions", industry: "B2B SaaS", description: "Product usage and billing changes feeding account health and renewal features.", sources: ["Product events", "Stripe", "CRM"], events_per_batch: 980, recommended_scenario: "schema_drift", icon: "boxes" },
  fintech_payments: { id: "fintech_payments", name: "Fintech payments", industry: "Financial services", description: "Authorized payments and support events with strict privacy controls.", sources: ["Payment gateway", "Ledger CDC", "Support API"], events_per_batch: 1560, recommended_scenario: "pii_leak", icon: "landmark" },
  mobile_sessions: { id: "mobile_sessions", name: "Mobile sessions", industry: "Consumer app", description: "Online and offline sessions feeding engagement and retention features.", sources: ["iOS events", "Android events", "Push service"], events_per_batch: 1840, recommended_scenario: "late_events", icon: "smartphone" },
  logistics_shipments: { id: "logistics_shipments", name: "Logistics shipments", industry: "Supply chain", description: "Scanner and carrier events feeding ETA and exception workflows.", sources: ["Warehouse scanners", "Carrier API", "GPS stream"], events_per_batch: 2110, recommended_scenario: "schema_drift", icon: "truck" },
  churn_features: { id: "churn_features", name: "Customer churn", industry: "Machine learning", description: "Usage, billing, and support signals feeding an explainable churn model.", sources: ["Feature store", "Billing", "Support cases"], events_per_batch: 720, recommended_scenario: "model_drift", icon: "brain-circuit" },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") {
        return json({ status: "ok", service: "driftops-worker", storage: env.DB ? "d1" : "memory", scenarios: Object.keys(SCENARIOS).length });
      }
      if (url.pathname === "/api/scenarios" && request.method === "GET") {
        return json({ scenarios: Object.values(SCENARIOS) });
      }
      if (url.pathname === "/api/samples" && request.method === "GET") {
        return json({ samples: Object.values(SAMPLES) });
      }
      if (url.pathname === "/api/runs" && request.method === "POST") {
        const body = await request.json();
        if (!SCENARIOS[body.scenario]) return json({ error: "unknown_scenario" }, 400);
        if (!SAMPLES[body.sample]) return json({ error: "unknown_sample" }, 400);
        const run = createRun(body.scenario, body.sample);
        RUNS.set(run.id, run);
        await persist(run, env);
        return json(snapshot(run), 201);
      }
      const match = url.pathname.match(/^\/api\/runs\/([a-z0-9]+)(?:\/(tick|repair|replay))?$/);
      if (match) {
        const [, id, action] = match;
        const run = RUNS.get(id) || await load(id, env);
        if (!run) return json({ error: "run_not_found" }, 404);
        if (request.method === "GET" && !action) return json(snapshot(run));
        if (request.method !== "POST" || !action) return json({ error: "method_not_allowed" }, 405);
        if (action === "tick") tick(run);
        if (action === "repair") repair(run);
        if (action === "replay") replay(run);
        RUNS.set(run.id, run);
        await persist(run, env);
        return json(snapshot(run));
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404 || !request.headers.get("accept")?.includes("text/html")) return secure(asset);
      const indexUrl = new URL(request.url);
      indexUrl.pathname = "/index.html";
      return secure(await env.ASSETS.fetch(new Request(indexUrl, request)));
    } catch (error) {
      return json({ error: "invalid_transition", message: error.message || "Request failed" }, 409);
    }
  },
};

function createRun(scenarioId, sampleId = "commerce_orders") {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID().replaceAll("-", "").slice(0, 12), scenarioId, sampleId, status: "running", step: 0, repaired: false, replayed: false, createdAt: now, updatedAt: now, actions: [] };
}

function tick(run) {
  if (run.status === "healthy") return;
  run.step = Math.min(run.step + 1, 6);
  if (run.step >= 4 && !run.repaired) run.status = "incident";
  run.updatedAt = new Date().toISOString();
}

function repair(run) {
  if (run.status !== "incident") throw new Error("Repair is available after the contract failure is detected.");
  run.repaired = true;
  run.status = "repairing";
  run.actions.push({ at: new Date().toISOString(), type: "repair", message: SCENARIOS[run.scenarioId].repair });
  run.updatedAt = new Date().toISOString();
}

function replay(run) {
  if (!run.repaired) throw new Error("Apply the repair before replaying quarantined events.");
  run.replayed = true;
  run.status = "healthy";
  run.actions.push({ at: new Date().toISOString(), type: "replay", message: "Quarantined events replayed with the repaired contract." });
  run.updatedAt = new Date().toISOString();
}

function snapshot(run) {
  const scenario = SCENARIOS[run.scenarioId];
  const sample = SAMPLES[run.sampleId] || SAMPLES.commerce_orders;
  const incident = run.step >= 4;
  const processed = run.step * sample.events_per_batch + (run.replayed ? Math.round(sample.events_per_batch * 0.3) : 0);
  const quarantined = run.replayed ? 0 : incident ? Math.min(96, (run.step - 3) * 24) : 0;
  const accepted = Math.max(0, processed - quarantined);
  const quality = run.replayed ? 100 : incident ? 72 : 100;
  const lag = run.replayed ? 1.2 : incident ? 47.8 : 1.8 + run.step * 0.3;
  const checkIds = { schema_drift: "schema", duplicate_burst: "uniqueness", late_events: "freshness", pii_leak: "privacy", model_drift: "drift" };
  const checks = [
    ["schema", "Schema contract"], ["uniqueness", "Event uniqueness"], ["freshness", "Event freshness"], ["privacy", "PII policy"], ["drift", "Feature drift"],
  ].map(([id, name]) => ({ id, name, status: incident && !run.replayed && checkIds[run.scenarioId] === id ? "fail" : "pass" }));
  const bad = quarantined > 0;
  const stages = [
    ["sources", "Sources", "ADF + APIs", processed, "healthy"],
    ["bronze", "Bronze", "Event Hubs / Delta", processed, "healthy"],
    ["silver", "Silver", "Databricks PySpark", accepted, bad ? "warning" : "healthy"],
    ["gold", "Gold", "Databricks SQL", accepted, bad && !run.repaired ? "blocked" : "healthy"],
    ["serve", "Feature API", "FastAPI", accepted, bad && !run.repaired ? "blocked" : "healthy"],
  ].map(([id, name, technology, count, state]) => ({ id, name, technology, count, state }));
  const activeIncident = incident && !run.replayed;
  return {
    id: run.id, status: run.status, step: run.step, scenario, sample, created_at: run.createdAt, updated_at: run.updatedAt,
    metrics: { processed, accepted, quarantined, quality_score: quality, consumer_lag_seconds: lag, estimated_cost_usd: Number((processed * 0.0000027).toFixed(4)) },
    stages, checks, actions: run.actions,
    incident: activeIncident || run.repaired ? {
      active: activeIncident, title: scenario.symptom, root_cause: scenario.root_cause,
      evidence: [`Failed check: ${scenario.failing_check}`, `First bad field: ${scenario.bad_field}`, "Upstream release: checkout-producer v3.4.0"],
      repair: scenario.repair, confidence: 94, grounding: "Contract failure, lineage edge, and quarantined event samples",
    } : null,
    quarantine: Array.from({ length: Math.min(quarantined, 6) }, (_, i) => ({ event_id: `evt_${run.id.slice(0, 4)}_${String(i).padStart(3, "0")}`, reason: scenario.failing_check, field: scenario.bad_field, value: ["unexpected_string", "duplicate", "2026-09-28T03:01:12Z"][i % 3], action: "held" })),
    lineage: { run_id: run.id, dataset: "customer_360", input_contract: "2.1", code_version: "portfolio-demo", model_version: "churn-v7", content_hash: `${run.id.slice(0, 8)}${String(run.step).padStart(8, "0")}` },
  };
}

async function ensureDb(env) {
  if (!env.DB) return;
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS pipeline_runs_v2 (
    id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, sample_id TEXT NOT NULL, status TEXT NOT NULL, step INTEGER NOT NULL,
    repaired INTEGER NOT NULL, replayed INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, actions_json TEXT NOT NULL
  )`);
}

async function persist(run, env) {
  if (!env.DB) return;
  await ensureDb(env);
  await env.DB.prepare(`INSERT INTO pipeline_runs_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, step=excluded.step, repaired=excluded.repaired,
    replayed=excluded.replayed, updated_at=excluded.updated_at, actions_json=excluded.actions_json`)
    .bind(run.id, run.scenarioId, run.sampleId, run.status, run.step, Number(run.repaired), Number(run.replayed), run.createdAt, run.updatedAt, JSON.stringify(run.actions)).run();
}

async function load(id, env) {
  if (!env.DB) return null;
  await ensureDb(env);
  const row = await env.DB.prepare("SELECT * FROM pipeline_runs_v2 WHERE id = ?").bind(id).first();
  if (!row) return null;
  return { id: row.id, scenarioId: row.scenario_id, sampleId: row.sample_id, status: row.status, step: row.step, repaired: Boolean(row.repaired), replayed: Boolean(row.replayed), createdAt: row.created_at, updatedAt: row.updated_at, actions: JSON.parse(row.actions_json) };
}

function json(body, status = 200) {
  return secure(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }));
}

function secure(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
