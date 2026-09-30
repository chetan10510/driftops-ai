-- Databricks notebook source
CREATE TABLE IF NOT EXISTS driftops.gold.customer_features (
  customer_id STRING,
  event_count_30d BIGINT,
  revenue_30d DECIMAL(18,2),
  last_event_at TIMESTAMP,
  plan_tier STRING,
  updated_at TIMESTAMP
) USING DELTA;

MERGE INTO driftops.gold.customer_features AS target
USING (
  SELECT customer_id,
         count(*) AS event_count_30d,
         sum(coalesce(order_total, 0)) AS revenue_30d,
         max(event_time) AS last_event_at,
         max(plan_tier) AS plan_tier,
         current_timestamp() AS updated_at
  FROM driftops.silver.customer_events
  WHERE event_time >= current_timestamp() - INTERVAL 30 DAYS
  GROUP BY customer_id
) AS source
ON target.customer_id = source.customer_id
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;

OPTIMIZE driftops.gold.customer_features ZORDER BY (customer_id);
