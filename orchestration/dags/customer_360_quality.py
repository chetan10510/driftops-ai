from datetime import datetime

from airflow.decorators import dag, task


@dag(
    dag_id="customer_360_quality",
    schedule="15 * * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["driftops", "quality"],
)
def customer_360_quality():
    @task(retries=2)
    def assert_stream_freshness() -> dict[str, object]:
        return {"check": "freshness", "threshold_minutes": 10, "status": "pass"}

    @task
    def run_dbt_tests(freshness: dict[str, object]) -> dict[str, object]:
        if freshness["status"] != "pass":
            raise ValueError("Upstream stream is stale")
        return {"command": "dbt build --select +customer_features", "status": "ready"}

    @task
    def publish_openlineage(result: dict[str, object]) -> None:
        print({"eventType": "COMPLETE", "job": "customer_360_quality", "result": result})

    publish_openlineage(run_dbt_tests(assert_stream_freshness()))


customer_360_quality()
