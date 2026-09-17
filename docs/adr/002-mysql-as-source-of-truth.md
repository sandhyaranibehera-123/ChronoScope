# ADR-002: MySQL as the sole authoritative business-state store

**Status**: Accepted

**Context**: Event sourcing with strict OCC needs mature, well-understood relational primitives: row-level locking, ACID transactions, foreign-key integrity, unique constraints.

**Decision**: MySQL 8.4 (LTS) is the write side and sole source of truth. Raw parameterized SQL via `mysql2`, no ORM — persistence stays transparent and auditable, matching the project's own subject matter.

**Consequences**: Every other store (MongoDB, Kafka, RabbitMQ, NATS, Redis, MinIO) is explicitly non-authoritative — see `docs/architecture/data-classification.md`. This decision was revisited twice (originally PostgreSQL, then MySQL, then a MySQL+MongoDB split) — see ADR-016.
