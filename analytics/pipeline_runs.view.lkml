view: pipeline_runs {
  sql_table_name: `driftops.pipeline_runs` ;;

  dimension: run_id { primary_key: yes type: string sql: ${TABLE}.run_id ;; }
  dimension: scenario { type: string sql: ${TABLE}.scenario ;; }
  dimension: status { type: string sql: ${TABLE}.status ;; }
  dimension_group: started { type: time timeframes: [raw, date, week] sql: ${TABLE}.started_at ;; }
  measure: runs { type: count }
  measure: quarantined_events { type: sum sql: ${TABLE}.quarantined_events ;; }
  measure: average_recovery_seconds { type: average sql: ${TABLE}.recovery_seconds ;; value_format_name: decimal_1 }
  measure: passed_runs { type: count filters: [status: "healthy"] }
}
