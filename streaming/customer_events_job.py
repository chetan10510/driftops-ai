"""Azure Databricks Structured Streaming job using Event Hubs' Kafka endpoint."""

import os

from pyspark.sql import SparkSession, functions as F, types as T


SCHEMA = T.StructType([
    T.StructField("event_id", T.StringType(), False),
    T.StructField("customer_id", T.StringType(), False),
    T.StructField("event_type", T.StringType(), False),
    T.StructField("event_time", T.TimestampType(), False),
    T.StructField("order_total", T.DecimalType(12, 2), True),
    T.StructField("customer_email", T.StringType(), True),
    T.StructField("plan_tier", T.StringType(), True),
])


spark = SparkSession.builder.appName("driftops-customer-360").getOrCreate()
spark.sparkContext.setLogLevel("WARN")

raw = (
    spark.readStream.format("kafka")
    .option("kafka.bootstrap.servers", os.environ["EVENT_HUBS_BOOTSTRAP_SERVERS"])
    .option("kafka.security.protocol", "SASL_SSL")
    .option("kafka.sasl.mechanism", "PLAIN")
    .option(
        "kafka.sasl.jaas.config",
        f'kafkashaded.org.apache.kafka.common.security.plain.PlainLoginModule required username="$ConnectionString" password="{os.environ["EVENT_HUBS_CONNECTION_STRING"]}";',
    )
    .option("subscribe", "customer-events")
    .option("startingOffsets", "earliest")
    .load()
)

parsed = raw.select(
    F.col("key").cast("string").alias("kafka_key"),
    F.from_json(F.col("value").cast("string"), SCHEMA).alias("event"),
    F.col("timestamp").alias("ingested_at"),
).select("kafka_key", "event.*", "ingested_at")

validated = (
    parsed.withColumn("contract_error", F.when(F.col("event_id").isNull(), "missing_event_id")
        .when(F.col("event_time").isNull(), "missing_event_time")
        .when(F.col("customer_email").contains("@"), "pii_not_tokenized")
        .otherwise(F.lit(None)))
    .withWatermark("event_time", "30 minutes")
    .dropDuplicates(["event_id"])
)

accepted = validated.filter(F.col("contract_error").isNull()).drop("contract_error")
quarantined = validated.filter(F.col("contract_error").isNotNull())

lake_root = os.getenv("LAKE_ROOT", "abfss://lake@driftopsdev.dfs.core.windows.net")
checkpoint = f"{lake_root}/_checkpoints/customer_events"
accepted.writeStream.format("delta").option("path", f"{lake_root}/silver/customer_events").option("checkpointLocation", f"{checkpoint}/accepted").outputMode("append").start()
quarantined.writeStream.format("delta").option("path", f"{lake_root}/quarantine/customer_events").option("checkpointLocation", f"{checkpoint}/quarantine").outputMode("append").start()
spark.streams.awaitAnyTermination()
