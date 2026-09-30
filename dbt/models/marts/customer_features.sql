{{ config(unique_key='customer_id') }}

with events as (
  select * from {{ ref('stg_customer_events') }}
  {% if is_incremental() %}
  where ingested_at > (select coalesce(max(last_event_at), '1970-01-01') from {{ this }})
  {% endif %}
)
select
  customer_id,
  count(*) as event_count_30d,
  sum(coalesce(order_total, 0)) as revenue_30d,
  max(event_time) as last_event_at,
  max(plan_tier) as plan_tier
from events
where event_time >= current_timestamp - interval '30 days'
group by customer_id
