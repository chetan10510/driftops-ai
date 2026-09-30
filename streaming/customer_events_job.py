"""Spark Structured Streaming reference job for the production topology."""

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
    .option("kafka.bootstrap.servers", os.getenv("KAFKA_BOOTSTRAP_SERVERS", "redpanda:9092"))
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

checkpoint = os.getenv("CHECKPOINT_ROOT", "/checkpoints")
accepted.writeStream.format("parquet").option("path", "/lake/silver/customer_events").option("checkpointLocation", f"{checkpoint}/accepted").outputMode("append").start()
quarantined.writeStream.format("json").option("path", "/lake/quarantine/customer_events").option("checkpointLocation", f"{checkpoint}/quarantine").outputMode("append").start()
spark.streams.awaitAnyTermination()
