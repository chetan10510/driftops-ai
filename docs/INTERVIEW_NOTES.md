# Interview Notes

## Two-minute walkthrough

1. Launch **Breaking schema drift** and let the fourth micro-batch fail.
2. Show that Bronze retains the input while Silver isolates 24 invalid events and Gold is blocked.
3. Open **Quality** to identify the one failing contract and **Lineage** to identify the producer release.
4. Apply the versioned field mapping, replay quarantine, and confirm every invariant returns to green.

## Questions this project can answer

- Why is at-least-once delivery paired with idempotency instead of claiming exactly-once everywhere?
- Why quarantine individual records but block publication of the affected aggregate?
- How do event-time watermarks change correctness, latency, and state cost?
- Why does deterministic validation decide pass/fail while AI only explains evidence?
- How would Kafka partition count, Spark state, file compaction, and backfill strategy change at 100x volume?
- Which metadata is required to reproduce an ML prediction after code and data have changed?

## Honest boundaries

- The public demo runs deterministic, seeded incidents rather than pretending to process millions of live events.
- Kafka and Spark are implemented as a runnable reference topology in the repository, not secretly emulated by the browser.
- Cloud resources are declared with Terraform but are not left running to avoid portfolio-demo spend.
