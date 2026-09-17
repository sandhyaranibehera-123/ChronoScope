# ADR-016: Polyglot persistence — MySQL (write) + MongoDB (read)

**Status**: Accepted

**Context**: The architecture went through PostgreSQL, then MySQL, then a request to split persistence "according to need" between MySQL and MongoDB. That split had to be made deliberately, not just because two databases sound more impressive.

**Decision**:
- **MySQL stays the write side / source of truth.** Event sourcing's OCC/dual-sequencing/three-way-invariant design depends on relational primitives (row locks, ACID transactions, FK integrity) that a document store doesn't give the same guarantees for. The event store itself never moves to MongoDB.
- **MongoDB becomes the read side.** CQRS projections (`order_summary`, `payment_summary`, `shipment_summary`) are exactly the "denormalized, per-query-shape, fully rebuildable" workload MongoDB is built for, and the split creates a genuine new demonstration: keeping two database engines consistent across a crash via a three-step ordered commit (idempotent Mongo upsert → MySQL inbox/checkpoint commit → Kafka offset commit — see `docs/spec/system-guarantees.md` rule 10), rather than a distributed transaction.

**Consequences**: A new recovery path (drop the MongoDB collection, rebuild purely from MySQL history, hash-verify) becomes one of the project's strongest demonstrations that the read side is genuinely disposable. `packages/read-store` (MongoDB) doesn't exist until Phase 4 — don't scaffold ahead of need.
