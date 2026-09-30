const fallbackScenarios = [
  { id: "schema_drift", name: "Breaking schema drift", risk: "Revenue mart outage", icon: "braces" },
  { id: "duplicate_burst", name: "Duplicate event burst", risk: "Inflated revenue", icon: "copy" },
  { id: "late_events", name: "Late mobile events", risk: "Stale customer features", icon: "clock" },
  { id: "pii_leak", name: "PII contract breach", risk: "Privacy exposure", icon: "shield-alert" },
  { id: "model_drift", name: "Feature distribution drift", risk: "Unreliable churn alerts", icon: "activity" },
];

const state = { scenarios: fallbackScenarios, selected: "schema_drift", run: null, busy: false, timeline: [] };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const icons = () => window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
const format = (value) => Number(value || 0).toLocaleString("en-US");

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  renderScenarios();
  icons();
  try {
    const response = await fetch("/api/scenarios");
    if (response.ok) {
      const data = await response.json();
      state.scenarios = data.scenarios;
      renderScenarios();
    }
  } catch (_) {
    notify("Demo API will connect after deployment.");
  }
});

function bindEvents() {
  $("#enter-btn").addEventListener("click", enterApp);
  $("#brand-home").addEventListener("click", (event) => { event.preventDefault(); resetToSetup(); });
  $("#launch-btn").addEventListener("click", launchRun);
  $("#advance-btn").addEventListener("click", () => mutate("tick"));
  $("#repair-btn").addEventListener("click", () => mutate("repair"));
  $("#replay-btn").addEventListener("click", () => mutate("replay"));
  $("#new-run").addEventListener("click", resetToSetup);
  $("#architecture-btn").addEventListener("click", () => $("#architecture-dialog").showModal());
  $("#close-dialog").addEventListener("click", () => $("#architecture-dialog").close());
  $("#export-btn").addEventListener("click", exportRun);
  $$(".side-nav button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
}

function enterApp() {
  $("#welcome").classList.add("hidden");
  $("#app").classList.remove("hidden");
  window.scrollTo({ top: 0 });
  icons();
}

function renderScenarios() {
  $("#scenario-grid").innerHTML = state.scenarios.map((scenario) => `
    <button class="scenario-card ${scenario.id === state.selected ? "selected" : ""}" data-scenario="${scenario.id}">
      <span class="scenario-check"><i data-lucide="check"></i></span>
      <span class="scenario-icon"><i data-lucide="${scenario.icon || "triangle-alert"}"></i></span>
      <h3>${scenario.name}</h3><p>${scenario.risk}</p>
    </button>`).join("");
  $$(".scenario-card").forEach((card) => card.addEventListener("click", () => {
    state.selected = card.dataset.scenario;
    $("#selected-name").textContent = state.scenarios.find((item) => item.id === state.selected)?.name || "Incident";
    renderScenarios();
  }));
  icons();
}

async function launchRun() {
  if (state.busy) return;
  setBusy(true);
  try {
    const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: state.selected }) });
    if (!response.ok) throw new Error("Could not launch the pipeline");
    state.run = await response.json();
    state.timeline = [{ tone: "ok", message: "Run created from contract v2.1", at: new Date() }];
    $("#setup").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#run-meta").classList.remove("hidden");
    renderRun();
    for (let i = 0; i < 4 && state.run?.status !== "incident"; i += 1) {
      await pause(520);
      await mutate("tick", true);
    }
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
  }
}

async function mutate(action, automatic = false) {
  if (!state.run || (state.busy && !automatic)) return;
  if (!automatic) setBusy(true);
  try {
    const response = await fetch(`/api/runs/${state.run.id}/${action}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Action failed");
    const previousStatus = state.run.status;
    state.run = data;
    addTimeline(action, previousStatus);
    renderRun();
    if (action === "repair") notify("Repair applied. Quarantined events are ready to replay.");
    if (action === "replay") notify("Recovery complete. All contracts are passing.");
  } catch (error) {
    notify(error.message);
  } finally {
    if (!automatic) setBusy(false);
  }
}

function addTimeline(action, previousStatus) {
  const entries = {
    tick: previousStatus !== "incident" && state.run.status === "incident"
      ? { tone: "warning", message: `${state.run.scenario.name} detected; ${state.run.metrics.quarantined} records isolated` }
      : { tone: "ok", message: `Micro-batch ${state.run.step} committed to Bronze` },
    repair: { tone: "ok", message: state.run.scenario.repair },
    replay: { tone: "ok", message: "Dead-letter queue replayed; Gold and Feature API recovered" },
  };
  state.timeline.unshift({ ...entries[action], at: new Date() });
}

function renderRun() {
  const run = state.run;
  if (!run) return;
  $("#run-id").textContent = `Run ${run.id}`;
  $("#run-status").textContent = titleCase(run.status);
  $("#incident-kicker").textContent = run.status === "incident" ? "Incident detected" : run.status === "healthy" ? "Recovery verified" : "Live pipeline";
  $("#work-title").textContent = run.scenario.name;
  $("#metric-processed").textContent = format(run.metrics.processed);
  $("#metric-accepted").textContent = format(run.metrics.accepted);
  $("#metric-quarantined").textContent = format(run.metrics.quarantined);
  $("#metric-lag").textContent = Number(run.metrics.consumer_lag_seconds).toFixed(1);
  $("#metric-cost").textContent = `$${Number(run.metrics.estimated_cost_usd).toFixed(4)}`;
  $("#quarantine-count").textContent = run.metrics.quarantined;
  $("#quality-count").textContent = run.checks.filter((check) => check.status === "pass").length;
  $("#quality-score").textContent = run.metrics.quality_score;
  $("#quality-score").classList.toggle("fail", run.metrics.quality_score < 100);
  const pill = $("#health-pill");
  pill.textContent = run.status === "healthy" ? "Healthy" : run.status === "incident" ? "Incident" : run.status === "repairing" ? "Repair ready" : "Running";
  pill.className = `status-pill ${run.status === "incident" ? "incident" : run.status === "running" ? "running" : ""}`;
  $("#pipeline-subtitle").textContent = run.status === "incident" ? run.scenario.symptom : run.status === "healthy" ? "Recovery checks passed and serving resumed" : `Processing micro-batch ${run.step + 1}`;
  $("#advance-btn").classList.toggle("hidden", ["incident", "repairing", "healthy"].includes(run.status));
  $("#repair-btn").classList.toggle("hidden", run.status !== "incident");
  $("#replay-btn").classList.toggle("hidden", run.status !== "repairing");
  renderPipeline(run);
  renderChecks(run);
  renderTimeline(run);
  renderQuality(run);
  renderQuarantine(run);
  renderLineage(run);
  icons();
}

function renderPipeline(run) {
  const stageIcons = { sources: "plug", bronze: "layers-3", silver: "filter", gold: "database", serve: "brain-circuit" };
  $("#pipeline").innerHTML = run.stages.map((stage, index) => {
    const node = `<article class="stage ${stage.state}"><div><span class="stage-icon"><i data-lucide="${stageIcons[stage.id]}"></i></span><h4>${stage.name}</h4><p>${stage.technology}</p></div><strong>${format(stage.count)}</strong></article>`;
    const link = index < run.stages.length - 1 ? `<span class="pipe-link ${stage.state === "blocked" || run.stages[index + 1].state === "blocked" ? "blocked" : stage.count ? "flowing" : ""}"></span>` : "";
    return node + link;
  }).join("");
}

function renderChecks(run) {
  $("#checks-list").innerHTML = run.checks.map((check) => `<div class="check-row ${check.status}"><i data-lucide="${check.status === "pass" ? "circle-check" : "circle-x"}"></i><span>${check.name}</span><span>${check.status}</span></div>`).join("");
}

function renderTimeline(run) {
  const items = [...state.timeline];
  if (run.incident) items.unshift({ tone: run.incident.active ? "warning" : "ok", message: run.incident.active ? `AI RCA · ${run.incident.root_cause}` : "RCA closed with verified replay", at: new Date() });
  $("#timeline").innerHTML = items.slice(0, 6).map((item) => `<div class="timeline-item ${item.tone}"><span class="timeline-dot"></span><div><p>${item.message}</p><time>${item.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div></div>`).join("");
}

function renderQuality(run) {
  const detail = {
    schema: ["order_total", "decimal, required"], uniqueness: ["event_id", "unique / 24h"], freshness: ["event_time", "lateness < 10m"], privacy: ["customer_email", "tokenized"], drift: ["plan_tier", "PSI < 0.20"],
  };
  $("#quality-table").innerHTML = run.checks.map((check) => `<div class="quality-rule"><strong>${check.name}</strong><code>${detail[check.id][0]}</code><span>${detail[check.id][1]}</span><span class="rule-result ${check.status}">${check.status}</span></div>`).join("");
}

function renderQuarantine(run) {
  $("#quarantine-table").innerHTML = run.quarantine.length ? run.quarantine.map((event) => `<tr><td>${event.event_id}</td><td>${event.reason}</td><td>${event.field}</td><td>${event.value}</td><td>${event.action}</td></tr>`).join("") : `<tr class="empty-row"><td colspan="5">No events are currently quarantined.</td></tr>`;
}

function renderLineage(run) {
  const nodes = [["Source", "checkout-api v3.4"], ["Dataset", "customer_events"], ["Transform", "identity_resolve"], ["Feature set", "churn_features"], ["Model", run.lineage.model_version]];
  $("#lineage-graph").innerHTML = nodes.map(([label, value]) => `<article class="lineage-node"><span>${label}</span><strong>${value}</strong></article>`).join("");
  $("#lineage-hash").textContent = run.lineage.content_hash;
  $("#lineage-details").innerHTML = [["Run ID", run.id], ["Contract", run.lineage.input_contract], ["Code", run.lineage.code_version], ["Dataset hash", run.lineage.content_hash]].map(([key, value]) => `<div><span>${key}</span><strong>${value}</strong></div>`).join("");
}

function setView(name) {
  $$(".side-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}-view`));
}

function resetToSetup() {
  state.run = null;
  state.timeline = [];
  $("#workspace").classList.add("hidden");
  $("#run-meta").classList.add("hidden");
  $("#setup").classList.remove("hidden");
  setView("operate");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exportRun() {
  if (!state.run) return;
  const blob = new Blob([JSON.stringify(state.run, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `driftops-${state.run.id}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setBusy(value) {
  state.busy = value;
  $("#launch-btn").disabled = value;
  $("#advance-btn").disabled = value;
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function titleCase(value) { return String(value).replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
