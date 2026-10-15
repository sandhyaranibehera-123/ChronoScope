# CHRONOSCOPE — Distributed Systems Laboratory

> **Guiding Principle**: CHRONOSCOPE does not use complexity as a feature. Every distributed component exists because it demonstrates a specific consistency, reliability, causality, execution, or recovery property that can be measured and verified.

---

## 1. Executive Architecture Overview

CHRONOSCOPE is a deterministic, distributed-systems laboratory demonstrating production-grade patterns without Kubernetes overhead (Docker Compose-first, K8s-portable later per ADR-014).

### Polyglot Persistence Split (ADR-016)

| Layer                            | Technology                | Database / Keyspace                     | Responsibility                                                                                                                                         | System Guarantees                                                                                                               |
| :------------------------------- | :------------------------ | :-------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| **Write Side (Source of Truth)** | **MySQL 8.4 LTS**         | `chronoscope_core`<br>`chronoscope_ops` | Immutable domain events, aggregate version tracking, row-level OCC locking, dual-sequencing, outbox & job leasing, timeline DAG hierarchy, audit logs. | Strict ACID, `innodb_autoinc_lock_mode = 2`, `SELECT ... FOR UPDATE` row locks, referential integrity. (Rules 1, 3, 5, 6, 8, 9) |
| **Read Side (CQRS Projections)** | **MongoDB 7.0**           | `chronoscope_read`                      | Denormalized, per-query-shape materialized view collections (`order_summary`, `payment_summary`, `shipment_summary`).                                  | Sequence-guarded idempotency, composite keys `${timelineId}:${aggregateId}`, 100% rebuildable from MySQL. (Rules 5, 10, 11)     |
| **Event Streaming Backbone**     | **Apache Kafka**          | `chronoscope.domain.events`             | Partitioned event transport bridging MySQL outbox to MongoDB projection workers and external subscribers.                                              | Keyed by composite aggregate key `${timelineId}:${aggregateId}`, preserving strict FIFO order per aggregate. (Rule 10)          |
| **Asynchronous Work Queue**      | **RabbitMQ**              | `chronoscope.jobs`                      | Decoupled background task execution, long-running jobs, retries, and dead-letter queues.                                                               | Keyed idempotency, at-most-once persistent effect despite at-least-once delivery. (Rule 8, ADR-005)                             |
| **Fast Control Plane**           | **NATS Core**             | `chronoscope.control.*`                 | Low-latency broadcast of desired worker states, pause/resume signals, and one-shot commands.                                                           | OCC-versioned state in MySQL, transport-only delivery, self-healing via `ControlReconciler`. (Rule 18, ADR-006)                 |
| **Internal High-Throughput RPC** | **gRPC**                  | Synchronous API ⇄ Replay                | Compact binary RPC for synchronous deterministic replay execution and diff evaluations.                                                                | Returns execution summary and hash proof, never raw bulk events inline. (Rule 19, ADR-011)                                      |
| **Snapshot & Blob Storage**      | **MinIO (S3-compatible)** | `chronoscope-snapshots`                 | Content-addressable binary snapshots of aggregate states and execution artifacts.                                                                      | SHA-256 verified `content_hash`, transparent fallback to raw event replay on corruption. (Rule 14, ADR-009)                     |
| **Ephemeral Cache & Limits**     | **Redis 7**               | Cache, Rate Limits                      | Ephemeral token rate limiting, fast health heartbeats, temporary locks.                                                                                | **Never used for correctness or truth** (Rule 20, ADR-015).                                                                     |

---

## 2. Phase Roadmap & Implementation Status

```
[████████████████████████████████████████████] 100.0% Complete (16 of 16 Phases)
```

| Phase  | Title                                | Status  | Tests | Core Focus & Landed Deliverables                                                                                                                                                                         |
| :----: | :----------------------------------- | :-----: | :---: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | **Foundation**                       | ✅ Done |   6   | Monorepo scaffold, MySQL connection pool, health endpoints, migration runner with `GET_LOCK`, dev JWT CLI, Docker Compose.                                                                               |
| **2**  | **Domain Modeling & Boundaries**     | ✅ Done |  28   | Pure domain core (Order, Payment, Inventory, Shipment), Dynamic Order Fulfillment Saga, compensation mapping, Rule 2 fitness test.                                                                       |
| **3**  | **Event Sourcing & Dual-Sequencing** | ✅ Done |  15   | MySQL event store, dual-sequencing (`aggregate_sequence` vs `timeline_position`), row-level OCC locking, 3-way invariant.                                                                                |
| **4**  | **CQRS Read Store & Outbox**         | ✅ Done |  18   | Transactional outbox leasing (`SKIP LOCKED`), Kafka in-memory/real publisher, MongoDB read store repository, projection worker.                                                                          |
| **5**  | **Zero-Downtime Projection Rebuild** | ✅ Done |  12   | Deterministic MongoDB collection rebuild with cutoff point, hash verification, advisory lock fencing (Rule 17).                                                                                          |
| **6**  | **Deterministic Replay Engine**      | ✅ Done |  14   | Snapshot manager with MinIO fallback, Live Replay engine proving bit-for-bit state hash parity against live MySQL state.                                                                                 |
| **7**  | **Timeline DAG & Counterfactuals**   | ✅ Done |  16   | Zero-copy timeline branching (`fork_position`), counterfactual replay, ancestor traversal via recursive SQL, state diff engine.                                                                          |
| **8**  | **Causal Graphs & Diagnosis**        | ✅ Done |  12   | Event causality tracing (`causation_id`, `correlation_id`), blast-radius analysis, cycle-safe graph traversal, DOT & Mermaid visualizers.                                                                |
| **9**  | **RabbitMQ Jobs & gRPC Replay**      | ✅ Done |  15   | Asynchronous job outbox leasing, RabbitMQ execution with crash-recovery proof, gRPC replay worker client and server.                                                                                     |
| **10** | **NATS Control Plane**               | ✅ Done |  11   | OCC-versioned worker desired states (`ACTIVE`/`PAUSED`), two-phase command cancellation, `ControlReconciler` packet-loss recovery.                                                                       |
| **11** | **Chaos Engine & Experiments**       | ✅ Done |  15   | Rule 21 safety gates (`CHAOS_MODE`, admin RBAC, 5-fault cap, TTL, kill-switch), Rule 22 manifests, signature `MONGODB_UNAVAILABLE` proof.                                                                |
| **12** | **Recovery Verification (8 Paths)**  | ✅ Done |   8   | All 8 formal disaster recovery paths verified (API crash, outbox failure, lease reaper, duplicate Kafka delivery, cold Mongo rebuild, RabbitMQ worker crash, NATS dropped packet, snapshot bit-rot).     |
| **13** | **Performance & Concurrency Lab**    | ✅ Done |   8   | High-throughput concurrent scaling, hot-spot OCC analysis, 4 SQL inventory race fixes, Mongo latency profiling.                                                                                          |
| **14** | **Security & DB Role Hardening**     | ✅ Done |  12   | Principle of least privilege: DB user roles, `SIGNAL SQLSTATE '45000'` immutable event trigger, Mongo collection auth.                                                                                   |
| **15** | **Formal & Property Testing**        | ✅ Done |   4   | Generative testing with `fc`: Mongo sequence guard convergence, contiguous Kafka checkpoints, racing appends, dual-sequencing monotonicity.                                                              |
| **16** | **Reproducibility & North-Star**     | ✅ Done |  25   | Pinned image digests, Rule Auditor engine (`chronoscope audit --quick/--deep`), full 8-act end-to-end automated demo script (`chronoscope demo`), Docker multi-stage & Cloud deployment (Render/Vercel). |

---

## 3. The 25 Non-Negotiable Architecture Rules

1. **MySQL is the sole authoritative business-state store.** Parameterized SQL only via `mysql2` (`?` placeholders), no ORM, no dynamic SQL identifiers except through a hardcoded allowlist. Schema migrations run under `GET_LOCK('chronoscope:migrations', timeout)`.
2. **Domain code never contains SQL or Mongo driver calls**; the API never contains either. Repository interfaces cleanly isolate persistence from pure decision logic.
3. **Events are immutable** — enforced at two independent layers: DB role privilege (`SELECT, INSERT` only) and an immutable trigger (`SIGNAL SQLSTATE '45000'`).
4. **Every event carries `schema_version`**; upcasters are mandatory before replaying historical payloads.
5. **Two sequence numbers with distinct semantics**: `aggregate_sequence` (per aggregate, contiguous, OCC lock) and `timeline_position` (per timeline, logical ordering, gaps permitted).
6. **Event append locks only the `aggregate_versions` row — never a timeline-wide lock.** Independent aggregates append 100% concurrently.
7. **A command targets exactly one aggregate.** Cross-aggregate workflows are coordinated via saga orchestrators.
8. **Three independent idempotency boundaries**: command dedup (`command_id`), event inbox (`event_id + consumer_name`), and job idempotency (`job_type + idempotency_key`).
9. **`aggregate_state` is updated in the same MySQL transaction as event append.** Three-way invariant: `aggregate_versions.current_sequence == aggregate_state.aggregate_sequence == MAX(events.aggregate_sequence)`.
10. **Three-step cross-engine commit on the read side**: (a) Idempotent MongoDB upsert; then (b) MySQL inbox/checkpoint commit; then (c) Kafka offset commit.
11. **Replay is deterministic**: canonical JSON, canonical hashes (`CHAR(64)`). Read store documents maintain `projectionHash`.
12. **Two replay modes**: `LIVE_REPLAY` (read-only against MySQL) and `COUNTERFACTUAL_REPLAY` (branch-local with simulated scenario inputs).
13. **Branches never copy parent history**; state is resolved via `WITH RECURSIVE` ancestor traversal.
14. **Snapshots are content-addressable and verifiable**: metadata in MySQL, blobs in MinIO with SHA-256 validation.
15. **Explicit compensation map** maps every forward operation to its deterministic compensation action. Amounts use `currency` + `amount_minor BIGINT`.
16. **Commands use typed failure categories and retry classifications.**
17. **Projection workers are fenced via MySQL advisory locks** (`GET_LOCK`), preventing concurrent rebuild races.
18. **NATS carries durable desired-state and one-shot commands**, both backed by MySQL tables.
19. **gRPC handles internal synchronous execution**, returning summary and hash proofs rather than bulk data.
20. **Redis is strictly for ephemeral caching and rate limiting**, never correctness.
21. **Strict Chaos Safety Gates**: `CHAOS_MODE=true` gate, `admin` RBAC, 5 concurrent fault cap, auto-expiry TTL, atomic kill switch, audit logging.
22. **Reproducible Experiment Manifests**: exact container digests, patch versions, dataset hash, Git SHA, and PRNG seeds.
23. **Eight formal recovery paths** covering every component crash and failure domain.
24. **Cross-Engine Audit**: `chronoscope audit --quick` and `--deep` validating three-way invariants and projection hash parity.
25. **Docker Compose is the local orchestrator** with defined service dependencies and health checks.

---

## 4. Deep Dive: Phase 1 Foundation ➔ Phase 11 Chaos Resilience

### Phase 1 Foundation: The Bedrock

Phase 1 established the strict architectural invariants that make the rest of the system possible:

- **No ORM**: Raw parameterized SQL prevents query generation anomalies and enforces explicit locking boundaries.
- **Strict Isolation**: Packages are separated by role (`@chronoscope/domain`, `@chronoscope/database`, `@chronoscope/contracts`, `@chronoscope/events`).
- **Hermetic Testing**: All unit and golden tests run 100% infra-free via high-fidelity in-memory simulators, enabling sub-second test execution without Docker dependencies.

### Phase 11 Chaos Engine: Proving Polyglot Resilience

Phase 11 built directly upon this bedrock by introducing a controlled fault injection framework and reproducible experiments:

- **Signature Fault `MONGODB_UNAVAILABLE`**: Proves that when the read database (MongoDB) goes down, the write path (MySQL) continues processing transactions and appending events uninterrupted. Outbox events buffer safely in Kafka, and once MongoDB recovers, projection workers drain the backlog with zero loss and reach sequence and hash parity with MySQL.
- **Signature Fault `MYSQL_UNAVAILABLE`**: Proves that when MySQL is unavailable, write commands fail fast with typed errors, while MongoDB continues serving read-only query models without degradation.
- **Rule 21 Safety Gates**: In-memory and Docker agents enforce that chaos can never run unchecked in production environments.
- **Rule 22 Manifests**: Every experiment run is recorded with pinned digests (`sha256:...`) and Git SHAs so that any anomaly can be reproduced deterministically years later.

### Phase 12 Disaster Recovery: The 8 Recovery Paths

Phase 12 systematically proved all eight recovery scenarios defined in the system failure matrix:

1. **API Crash before MySQL Commit**: Clean client retry with command dedup, leaving zero orphaned state.
2. **API Crash post-MySQL Commit**: Background transactional outbox lease publisher guarantees at-least-once Kafka publishing.
3. **Outbox Lease Reaper**: Expired leases (>30s) are automatically reclaimed when an outbox worker crashes mid-lease.
4. **Duplicate Kafka Delivery**: MySQL inbox table (`projection_inbox`) safely absorbs redeliveries without reapplying Mongo upserts.
5. **Total MongoDB Loss**: Dropping the read collection and running a cold rebuild from MySQL event store restores 100% hash parity.
6. **RabbitMQ Job Worker Crash**: At-most-once persistent effect preserved despite at-least-once message redelivery.
7. **NATS Dropped Control Packet**: Background `ControlReconciler` detects missed desired-state broadcasts and converges workers.
8. **Snapshot Bit-Rot**: If a stored snapshot fails its SHA-256 integrity check, the replay engine automatically falls back to raw event replay from genesis without error.

### Phase 13 Concurrency Lab: Contention & Inventory Race Fixes

Phase 13 implemented rigorous benchmarks and 4 SQL inventory race allocation strategies:

- **Scaling Benchmark**: Proved 100 independent aggregates append concurrently with 0 lock contention under `innodb_autoinc_lock_mode = 2`.
- **OCC Contention Benchmark**: 50 contending writers racing on the same sequence anchor yield exactly 1 slot winner without retries and 100% convergence under jittered exponential backoff.
- **4 Inventory Strategies**:
  1. _Uncontrolled Read-Modify-Write_: Reliably demonstrates the classic lost update oversell defect.
  2. _Pessimistic Row Locking (`SELECT ... FOR UPDATE`)_: Serializes allocation and completely eliminates overselling.
  3. _Atomic Conditional Update (`UPDATE ... WHERE available >= ?`)_: Single SQL atomic statement with zero overselling.
  4. _Event-Sourced OCC_: Pure domain event appending with version check and retry, preserving full audit history and state hash parity.
- **Mongo Latency Profiling**: Measured end-to-end decoupled CQRS pipeline stages (Stage 1 MySQL append, Stage 2 Kafka publish, Stage 3 MongoDB commit).

### Phase 14 Security & Database Role Hardening

Phase 14 implemented least-privilege role boundaries enforced at the database engine level:

- **MySQL Roles**: `chronoscope_owner`, `chronoscope_migrator`, `chronoscope_app`, `chronoscope_projection_worker`, `chronoscope_rebuild_controller`, `chronoscope_publisher`.
- **Database Immutability Triggers**: `trg_events_prevent_update`, `trg_events_prevent_delete`, `trg_system_events_prevent_update`, and `trg_system_events_prevent_delete` raising `SIGNAL SQLSTATE '45000'` on any mutation attempt.
- **Database-Enforced Rule 17**: `chronoscope_projection_worker` granted `SELECT` only on `projection_metadata` — writes strictly forbidden at the MySQL engine layer.
- **MongoDB Collection Privileges**: Shadow collection write privileges separated from live collection read-only projections.

### Phase 15 Formal & Property Testing

Phase 15 introduced a zero-dependency generative property testing engine (`packages/testing/src/property/`) powered by a deterministic Mulberry32 PRNG and composable Arbitraries:

- **Property 1 (Mongo Sequence Guard Convergence)**: Proves that arbitrary message reorderings, duplicates, and burst injections always converge to bit-for-bit identical state and `projectionHash` (Rules 10 & 11).
- **Property 2 (Kafka Checkpoint Monotonicity)**: Proves that arbitrary out-of-order deliveries maintain a contiguous, monotonic high-water mark without checkpoint regression.
- **Property 3 (Racing Appends OCC Invariant)**: Proves that across $W \in [2, 20]$ racing writers with `expectedSequence = 0`, exactly 1 succeeds and $W-1$ receive `ConcurrencyError` (Rules 5 & 6).
- **Property 4 (Dual-Sequencing Monotonicity)**: Proves that across arbitrary multi-aggregate workloads, `aggregate_sequence` is contiguous per aggregate while `timeline_position` is monotonically strictly increasing across the timeline.

### Phase 16 Reproducibility, Rule Auditor & North-Star Demonstration

Phase 16 finalized the laboratory with automated auditing and demonstration tooling:

- **Pinned Image Digests**: `mysql:8.4.0-lts` (`sha256:6905541b...`), `mongo:7.0.5` (`sha256:94dfaa55...`).
- **Rule Auditor CLI**: `chronoscope audit [--quick | --deep]` verifies all 25 frozen architecture rules programmatically, yielding a cryptographic SHA-256 audit verification hash.
- **North-Star 8-Act Demonstration**: `chronoscope demo` runs an automated, end-to-end execution of the entire laboratory:
  - **Act 1**: Authoritative Mainline Event Sourcing & Three-Way Invariant.
  - **Act 2**: CQRS Decoupled Ingestion to MongoDB Read Store.
  - **Act 3**: Content-Addressed Snapshotting & Storage Fallback.
  - **Act 4**: Zero-Copy Branching & Counterfactual Divergence with Diff Engine.
  - **Act 5**: Causal Graph Tracing & Root-Cause Analysis.
  - **Act 6**: Chaos Injection (`MONGODB_UNAVAILABLE`) & Cold Read-Store Disaster Recovery.
- **Cloud Deployment Configurations**:
  - `render.yaml`: Blueprint orchestrating `chronoscope-api` (Fastify Web Service), `chronoscope-worker` (Background Job & Outbox Worker), `chronoscope-projection-worker` (CQRS Worker), with managed MySQL, MongoDB, and Redis.
  - `vercel.json`: Edge SPA deployment for `apps/web` with secure reverse proxy rewrites to API on Render.
  - `Dockerfile`: Multi-stage, minimal non-root production container.
