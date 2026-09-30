# Databricks notebook source
from pyspark.sql import functions as F, types as T
from delta.tables import DeltaTable

dbutils.widgets.text("run_id", "")
dbutils.widgets.text("source_name", "checkout")
run_id = dbutils.widgets.get("run_id")
source_name = dbutils.widgets.get("source_name")

schema = T.StructType([
    T.StructField("event_id", T.StringType(), False),
    T.StructField("customer_id", T.StringType(), False),
    T.StructField("event_type", T.StringType(), False),
    T.StructField("event_time", T.TimestampType(), False),
    T.StructField("order_total", T.DecimalType(12, 2), True),
    T.StructField("customer_email", T.StringType(), True),
    T.StructField("plan_tier", T.StringType(), True),
])

account = spark.conf.get("driftops.storage_account")
bronze_path = f"abfss://lake@{account}.dfs.core.windows.net/bronze/{source_name}/{run_id}"
silver_path = f"abfss://lake@{account}.dfs.core.windows.net/silver/customer_events"
quarantine_path = f"abfss://lake@{account}.dfs.core.windows.net/quarantine/customer_events"

raw = spark.read.schema(schema).json(bronze_path).withColumn("_run_id", F.lit(run_id)).withColumn("_ingested_at", F.current_timestamp())
validated = raw.withColumn(
    "_contract_error",
    F.when(F.col("event_id").isNull(), "missing_event_id")
     .when(F.col("customer_id").isNull(), "missing_customer_id")
     .when(F.col("order_total") < 0, "negative_order_total")
     .when(F.col("customer_email").rlike("@"), "pii_not_tokenized")
)

valid = validated.filter(F.col("_contract_error").isNull()).drop("_contract_error")
invalid = validated.filter(F.col("_contract_error").isNotNull())
invalid.write.format("delta").mode("append").partitionBy("_contract_error").save(quarantine_path)

if DeltaTable.isDeltaTable(spark, silver_path):
    DeltaTable.forPath(spark, silver_path).alias("t").merge(valid.alias("s"), "t.event_id = s.event_id").whenNotMatchedInsertAll().execute()
else:
    valid.write.format("delta").partitionBy("event_type").save(silver_path)

dbutils.notebook.exit({"accepted": valid.count(), "quarantined": invalid.count(), "run_id": run_id})
