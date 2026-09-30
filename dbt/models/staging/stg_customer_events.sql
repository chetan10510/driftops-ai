select
  cast(event_id as varchar) as event_id,
  cast(customer_id as varchar) as customer_id,
  lower(event_type) as event_type,
  cast(event_time as timestamp) as event_time,
  cast(order_total as decimal(12, 2)) as order_total,
  cast(plan_tier as varchar) as plan_tier,
  ingested_at
from {{ source('silver', 'customer_events') }}
where event_id is not null
