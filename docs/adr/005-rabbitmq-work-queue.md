# ADR-005: RabbitMQ for work delivery, MySQL `jobs` for job truth

**Status**: Accepted (implemented Phase 9)

**Context**: Asynchronous work (snapshot generation, projection rebuild, exports, benchmarks) needs retry/backoff/DLQ semantics distinct from domain-event distribution.

**Decision**: RabbitMQ delivers work; `chronoscope_ops.jobs` + `job_outbox` (mirroring the domain outbox's leasing pattern) hold the authoritative job lifecycle. RabbitMQ is never job truth — a DLQ message is not the only permanent failure record.

**Consequences**: The same dual-write problem the domain outbox solves for Kafka gets the identical fix for RabbitMQ, rather than a bespoke second mechanism.
