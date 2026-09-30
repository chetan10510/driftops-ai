connection: "driftops_bigquery"
include: "/views/*.view.lkml"

explore: pipeline_runs {
  label: "Pipeline Reliability"
  description: "Run-level quality, quarantine, and recovery metrics"
}
