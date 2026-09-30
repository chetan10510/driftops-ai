from datetime import datetime

from airflow.decorators import dag, task
from airflow.providers.microsoft.azure.operators.data_factory import AzureDataFactoryRunPipelineOperator


@dag(
    dag_id="customer_360_recovery",
    schedule=None,
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    params={"window_start": "", "window_end": "", "source_name": "checkout"},
    tags=["driftops", "backfill", "recovery"],
)
def customer_360_recovery():
    @task
    def validate_window(window_start: str, window_end: str) -> dict[str, str]:
        start = datetime.fromisoformat(window_start.replace("Z", "+00:00"))
        end = datetime.fromisoformat(window_end.replace("Z", "+00:00"))
        if start >= end:
            raise ValueError("window_start must be earlier than window_end")
        if (end - start).days > 7:
            raise ValueError("Backfills are capped at seven days per run")
        return {"windowStart": window_start, "windowEnd": window_end}

    window = validate_window("{{ params.window_start }}", "{{ params.window_end }}")
    run_adf = AzureDataFactoryRunPipelineOperator(
        task_id="run_adf_recovery_pipeline",
        azure_data_factory_conn_id="azure_data_factory",
        factory_name="{{ var.value.driftops_adf_name }}",
        resource_group_name="{{ var.value.driftops_resource_group }}",
        pipeline_name="pl_customer360_incremental",
        parameters={
            "windowStart": "{{ ti.xcom_pull(task_ids='validate_window')['windowStart'] }}",
            "windowEnd": "{{ ti.xcom_pull(task_ids='validate_window')['windowEnd'] }}",
            "sourceName": "{{ params.source_name }}",
        },
        wait_for_termination=True,
    )

    @task
    def publish_recovery_evidence(run_id: str | None) -> None:
        print({"event_type": "RECOVERY_COMPLETE", "adf_run_id": run_id, "evidence": "ADF output retained in Log Analytics"})

    window >> run_adf
    publish_recovery_evidence(run_adf.output)


customer_360_recovery()
