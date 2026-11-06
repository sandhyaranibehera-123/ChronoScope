# CHRONOSCOPE — Complete System Specification & Architecture Reference

> **Guiding Principle**: CHRONOSCOPE does not use complexity as a feature. Every distributed component exists because it demonstrates a specific consistency, reliability, causality, execution, or recovery property that can be measured and verified.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [High-Level Architecture & Polyglot Persistence](#2-high-level-architecture--polyglot-persistence)
3. [The 25 Non-Negotiable Architecture Rules](#3-the-25-non-negotiable-architecture-rules)
4. [Monorepo Structure & Package Boundaries](#4-monorepo-structure--package-boundaries)
5. [16-Phase Implementation Roadmap](#5-16-phase-implementation-roadmap)
6. [Deep-Dive: Core Subsystems & Mechanisms](#6-deep-dive-core-subsystems--mechanisms)
   - [6.1 Event Sourcing, Dual-Sequencing & OCC](#61-event-sourcing-dual-sequencing--occ)
   - [6.2 The CQRS Pipeline & 3-Step Cross-Engine Commit](#62-the-cqrs-pipeline--3-step-cross-engine-commit)
   - [6.3 Zero-Downtime Projection Rebuild](#63-zero-downtime-projection-rebuild)
   - [6.4 Deterministic Replay & Bit-for-Bit Hash Parity](#64-deterministic-replay--bit-for-bit-hash-parity)
   - [6.5 Timeline DAG & Counterfactual Branching](#65-timeline-dag--counterfactual-branching)
   - [6.6 Causal Graph & Root-Cause Diagnosis](#66-causal-graph--root-cause-diagnosis)
   - [6.7 Asynchronous Background Jobs & RabbitMQ](#67-asynchronous-background-jobs--rabbitmq)
   - [6.8 Fast Control Plane & NATS Core](#68-fast-control-plane--nats-core)
   - [6.9 Chaos Engineering & Experiment Manifests](#69-chaos-engineering--experiment-manifests)
   - [6.10 The 8 Formal Disaster Recovery Paths](#610-the-8-formal-disaster-recovery-paths)
   - [6.11 Concurrency Lab & 4 Inventory Allocation Strategies](#611-concurrency-lab--4-inventory-allocation-strategies)
   - [6.12 Database Security & Role Hardening](#612-database-security--role-hardening)
   - [6.13 Generative Property Testing Engine](#613-generative-property-testing-engine)
7. [API Specification & Endpoints](#7-api-specification--endpoints)
8. [Interactive Web Dashboard (9 Pages)](#8-interactive-web-dashboard-9-pages)
9. [CLI Command Suite (17 Commands)](#9-cli-command-suite-17-commands)
10. [Docker Compose & Cloud Deployment](#10-docker-compose--cloud-deployment)
11. [Developer Quickstart & Verification](#11-developer-quickstart--verification)

---

## 1. Executive Summary

**CHRONOSCOPE** is a deterministic distributed-systems laboratory engineered to demonstrate, measure, and verify core distributed-systems properties:

- **Event Sourcing & Strict OCC**: Contiguous per-aggregate versioning, global logical timeline ordering, and pure state reduction.
- **Polyglot CQRS**: Relational write-side (MySQL 8.4) with transactional outbox coupled with a denormalized read-side (MongoDB 7.0) via an ordered three-step cross-engine commit.
- **Deterministic Replay & Hash Parity**: Mathematical proof of state correctness (`state_hash == replay_hash`) from genesis or verified content-addressable snapshots (MinIO).
- **Timeline DAG & Counterfactuals**: Zero-copy branching with `WITH RECURSIVE` ancestor resolution, scenario overrides, and deterministic state diffing.
- **Causal Graph**: Graph-based causality tracing across `causation_id`, `correlation_id`, and timeline parentage to calculate blast radiuses and perform automated root-cause analysis.
- **Resilience & Chaos Engineering**: Controlled fault injection (`MONGODB_UNAVAILABLE`, `MYSQL_UNAVAILABLE`, latency, partitions) with Rule 21 safety gates and bit-for-bit recovery across 8 failure modes.
- **Infrastructure Simplicity**: Docker Compose-first, portable to Kubernetes later without vendor lock-in.

---

## 2. High-Level Architecture & Polyglot Persistence

CHRONOSCOPE assigns each storage and messaging technology a strict, non-overlapping architectural responsibility (ADR-016):

| Technology        | Layer / Database                        | Core Responsibility                                                                                                                                       | System Guarantee & Invariant                                                                                                       |
| :---------------- | :-------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| **MySQL 8.4 LTS** | `chronoscope_core`<br>`chronoscope_ops` | Write side & sole source of truth: immutable domain events, row-level OCC, dual-sequencing, aggregate states, outbox, timeline DAG hierarchy, audit logs. | Strict ACID, `innodb_autoinc_lock_mode = 2`, `SELECT ... FOR UPDATE` row locks, referential integrity. (Rules 1, 3, 5, 6, 8, 9)    |
| **MongoDB 7.0**   | `chronoscope_read`                      | Read side (CQRS query model): materialized views (`order_summary`, `payment_summary`, `shipment_summary`).                                                | Sequence-guarded upsert idempotency, composite keys `${timelineId}:${aggregateId}`, 100% rebuildable from MySQL. (Rules 5, 10, 11) |
| **Apache Kafka**  | `chronoscope.domain.events`             | Partitioned event transport bridging MySQL outbox to projection workers.                                                                                  | Keyed by composite aggregate key `${timelineId}:${aggregateId}`, strict FIFO ordering per aggregate. (Rule 10)                     |
| **RabbitMQ**      | `chronoscope.jobs`                      | Asynchronous work queues, job dispatch, retries, dead-letter exchanges.                                                                                   | At-most-once persistent effect despite at-least-once network delivery via keyed idempotency. (Rule 8, ADR-005)                     |
| **NATS Core**     | `chronoscope.control.*`                 | Low-latency broadcast control plane: worker desired states (`ACTIVE`/`PAUSED`) and one-shot commands.                                                     | OCC-versioned state in MySQL, transport-only delivery, self-healing via `ControlReconciler`. (Rule 18, ADR-006)                    |
| **gRPC**          | Synchronous RPC                         | Compact binary RPC for synchronous deterministic replay execution and diff evaluations.                                                                   | Returns execution summary and hash proof, never raw bulk events inline. (Rule 19, ADR-011)                                         |
| **MinIO (S3)**    | `chronoscope-snapshots`                 | Content-addressable binary snapshots of aggregate states and execution artifacts.                                                                         | SHA-256 verified `content_hash`, transparent fallback to raw event replay on bit-rot. (Rule 14, ADR-009)                           |
| **Redis 7**       | Cache / Ephemeral                       | Ephemeral token rate limiting, fast health heartbeats, temporary lease locks.                                                                             | **Never used for correctness or truth** (Rule 20, ADR-015).                                                                        |

```
                       ┌────────────────────────────────────────────────────────┐
                       │                     CLIENT / CLI / UI                   │
                       └───────────────────┬────────────────────────────────┬───┘
                                           │ Commands                       │ Queries
                                           ▼                                ▼
                       ┌───────────────────────────────────────┐  ┌─────────────────────┐
                       │       apps/api (Fastify REST)         │  │ MongoDB 7.0 (CQRS)  │
                       │   - Validates Commands (Zod)          │  │ `chronoscope_read`  │
                       │   - Command Deduplication             │  │ - order_summary     │
                       │   - Dispatches to Domain Service      │  │ - payment_summary   │
                       └───────────────────┬───────────────────┘  └──────────▲──────────┘
                                           │ Atomic Transaction              │
                                           ▼                                 │ Step (a)
┌────────────────────────────────────────────────────────────────────────┐   │ Idempotent
│                         MySQL 8.4 LTS (Write Store)                    │   │ Upsert
│  `chronoscope_core`                                                    │   │
│   ├── aggregate_versions (Row OCC Lock: SELECT ... FOR UPDATE)         │   │
│   ├── events (Append-only immutable log, dual-sequenced)               │   │
│   ├── aggregate_state (Incremental materialization + state_hash)       │   │
│   ├── timelines (DAG hierarchy, fork_position, head_position)          │   │
│   └── outbox (SKIP LOCKED transactional outbox leasing)                │   │
│  `chronoscope_ops`                                                     │   │
│   ├── command_deduplication (Idempotency cache)                        │   │
│   ├── projection_inbox & projection_checkpoints (Ordered 3-step commit)│   │
│   └── worker_controls & control_commands (NATS desired states)         │   │
└──────────────────────────────────┬─────────────────────────────────────┘   │
                                   │ Lease Worker                            │
                                   ▼                                         │
                       ┌──────────────────────┐                              │
                       │     Apache Kafka     │──────────────────────────────┘
                       │ Domain Event Stream  │  Step (b): MySQL Checkpoint Commit
                       └──────────────────────┘  Step (c): Kafka Offset Commit
```

---

## 3. The 25 Non-Negotiable Architecture Rules

1. **MySQL is the sole authoritative business-state store**: Parameterized SQL only via `mysql2` (`?` placeholders), no ORM, no dynamic SQL identifiers except through a hardcoded allowlist. Schema migrations run under `GET_LOCK('chronoscope:migrations', timeout)`.
2. **Domain isolation**: Domain code never contains SQL or Mongo driver calls; the API never contains either. Repositories isolate persistence from pure domain logic.
3. **Immutable events**: Enforced at two independent layers: DB role privilege (`SELECT, INSERT` only) and an immutable trigger (`SIGNAL SQLSTATE '45000'`). Domain events and system events are stored in physically separate tables.
4. **Schema versioning & upcasting**: Every event carries `schema_version`. Upcasters are mandatory before replaying historical payloads.
5. **Two sequence numbers with distinct semantics**:
   - `aggregate_sequence`: Contiguous per `(timeline_id, aggregate_id)`, derived from row-locked `aggregate_versions`, used for OCC.
   - `timeline_position`: Monotonic per `timeline_id`, allocated via AUTO_INCREMENT table sequence, gaps permitted, logical order key.
6. **Row-level OCC locking**: Event append locks only the `aggregate_versions` row — never a timeline-wide lock. Configured with `innodb_autoinc_lock_mode = 2`. Independent aggregates append 100% concurrently.
7. **Single aggregate targeting**: A command targets exactly one aggregate. Cross-aggregate workflows are orchestrated via sagas.
8. **Three independent idempotency boundaries**:
   - Command dedup (`command_id`)
   - Event inbox (`event_id + consumer_name`)
   - Job idempotency (`job_type + idempotency_key`)
   - Guarantee: At-most-once persistent effect despite at-least-once delivery.
9. **Three-way invariant**: `aggregate_state` is updated in the same MySQL transaction as event append:
   $$\text{aggregate\_versions.current\_sequence} == \text{aggregate\_state.aggregate\_sequence} == \max(\text{events.aggregate\_sequence})$$
   State hashing excludes transport/identity metadata.
10. **Three-step cross-engine commit on read side**:
    1. Idempotent MongoDB upsert (`w:1, j:true`) keyed by `${timelineId}:${aggregateId}`.
    2. MySQL inbox & checkpoint commit.
    3. Kafka offset commit.
11. **Deterministic replay & canonical hashes**: Canonical JSON, `CHAR(64)` SHA-256 hashes. Read store documents carry `projectionHash`.
12. **Two replay modes**: `LIVE_REPLAY` (read-only against MySQL) and `COUNTERFACTUAL_REPLAY` (branch-local with simulated scenario inputs).
13. **Zero-copy branching**: Child timelines never copy parent events. State is dynamically resolved via `WITH RECURSIVE` ancestor traversal.
14. **Content-addressable snapshots**: Metadata in MySQL, payload in MinIO with SHA-256 validation. Automatic fallback to raw event replay if snapshot bit-rot occurs.
15. **Explicit compensation map**: Every forward operation maps to a deterministic compensation action. Currency values stored as `currency` + `amount_minor BIGINT`.
16. **Typed failures & retry classification**: Errors classified as `RETRYABLE`, `NON_RETRYABLE`, or `FATAL`.
17. **Fenced projection workers**: Rebuild and projection workers fenced via MySQL advisory locks (`GET_LOCK`). Workers cannot write metadata tables.
18. **Durable NATS control plane**: Worker desired states and one-shot commands are backed by MySQL tables; NATS serves as low-latency transport.
19. **Compact gRPC RPC**: gRPC handles synchronous replay and diff execution, returning execution IDs, state hashes, and summaries, never bulk events inline.
20. **Redis ephemeral role**: Strictly limited to caching, rate limits, and heartbeats — never correctness.
21. **Strict chaos safety gates**: Requires `CHAOS_MODE=true`, `admin` RBAC, max 5 concurrent faults, auto-expiring TTLs, and an emergency kill switch.
22. **Reproducible experiment manifests**: Pinned image digests (`sha256:...`), exact patch versions, dataset hashes, and Git SHAs.
23. **Eight formal disaster recovery paths**: Systematic recovery validation across all system failure modes.
24. **Cross-engine audit**: `chronoscope audit --quick` (live-tolerant) and `--deep` (quiesced, strict) enforcing three-way invariants and hash parity.
25. **Docker Compose orchestration**: Local multi-container environment with explicit health checks and container dependency ordering.

---

## 4. Monorepo Structure & Package Boundaries

The project is structured as an npm/TypeScript workspace enforcing strict separation of concerns:

```
Chronoscope/
├── apps/
│   ├── api/                 # Fastify REST API server (Commands, Queries, Timelines, Chaos, Controls)
│   ├── chaos-agent/         # Host-level Docker chaos injection daemon
│   ├── cli/                 # Developer and operator CLI (17 subcommands)
│   ├── projection-worker/   # CQRS Kafka-to-MongoDB ingestion and projection builder
│   ├── replay-worker/       # gRPC replay server executing deterministic live/counterfactual replay
│   ├── web/                 # Vite + React + Tailwind + Lucide dashboard (9 interactive labs)
│   └── worker/              # RabbitMQ async background job consumer & NATS control listener
├── packages/
│   ├── chaos/               # Chaos engine, fault definitions, experiment runner, safety gates
│   ├── contracts/           # Zod schemas, OpenAPI specs, gRPC proto definitions, API DTOs
│   ├── database/            # MySQL connection pool, migrations (0001-0014), raw SQL repositories
│   ├── domain/              # Pure business core: Order, Payment, Inventory, Shipment, Sagas, Hash
│   ├── events/              # Event catalog, canonical envelope builder, schema upcasters
│   ├── messaging/           # Kafka producer/consumer, RabbitMQ job queue, NATS control client
│   ├── observability/       # Structured Pino logger, metrics, tracing hooks
│   ├── read-store/          # MongoDB client, CQRS read repositories, projection hash verifier
│   ├── replay-engine/       # Live/Counterfactual replay, SnapshotManager, Timeline DAG, Diff, Causal Graph
│   └── testing/             # Testcontainers helpers, property-testing engine (Mulberry32 PRNG)
├── tests/
│   ├── golden/              # 10 Golden end-to-end integration scenario test suites
│   ├── performance/         # Concurrency, scaling, and inventory race condition lab tests
│   └── property/            # 4 Generative property test suites (fast-check inspired)
├── infrastructure/
│   └── docker/              # MySQL configuration (`my.cnf` pinning `innodb_autoinc_lock_mode=2`)
├── scripts/                 # Bootstrap, reset, wait-for-healthy, and database seed scripts
├── docker-compose.yml       # Primary orchestration for all 8 infrastructure engines
├── Makefile                 # Canonical task runner (`make test`, `make dev`, `make audit`, etc.)
└── vitest.config.ts         # Fast, infra-free unit and golden test suite configuration
```

---

## 5. 16-Phase Implementation Roadmap

The laboratory was built in 16 structured, verified phases:

```
[████████████████████████████████████████████] 100% Complete (16 / 16 Phases | 182 Tests Passing)
```

| Phase  | Name                                  | Focus & Key Deliverables                                                                                          | Status  |
| :----: | :------------------------------------ | :---------------------------------------------------------------------------------------------------------------- | :-----: |
| **1**  | **Foundation**                        | Monorepo scaffold, MySQL pool, `GET_LOCK` migration runner, health routes, dev JWT CLI.                           | ✅ Done |
| **2**  | **Domain Modeling & Boundaries**      | Pure domain aggregates (Order, Payment, Inventory, Shipment), Dynamic Saga, Rule 2 fitness test.                  | ✅ Done |
| **3**  | **Event Sourcing & Dual-Sequencing**  | MySQL event store, dual-sequencing, row-locked OCC, three-way invariant, outbox leasing.                          | ✅ Done |
| **4**  | **CQRS Read Store & Outbox**          | Transactional outbox leasing (`SKIP LOCKED`), Kafka publisher, MongoDB read store, projection worker.             | ✅ Done |
| **5**  | **Zero-Downtime Projection Rebuild**  | Cutoff point selection, shadow collection rebuild, hash verification, MySQL advisory lock fencing.                | ✅ Done |
| **6**  | **Deterministic Replay Engine**       | Snapshot manager with MinIO fallback, live replay proving bit-for-bit hash parity against MySQL.                  | ✅ Done |
| **7**  | **Timeline DAG & Counterfactuals**    | Zero-copy branching, `WITH RECURSIVE` ancestor traversal, scenario overrides, state diff engine.                  | ✅ Done |
| **8**  | **Causal Graphs & Diagnosis**         | Event causality tracing (`causation_id`, `correlation_id`), blast radius, cycle-safe traversal, DOT/Mermaid.      | ✅ Done |
| **9**  | **RabbitMQ Jobs & gRPC Replay**       | Asynchronous job outbox, RabbitMQ execution with crash recovery, compact gRPC replay client/server.               | ✅ Done |
| **10** | **NATS Control Plane**                | OCC-versioned worker desired states (`ACTIVE`/`PAUSED`), two-phase cancellation, `ControlReconciler`.             | ✅ Done |
| **11** | **Chaos Engine & Experiments**        | Rule 21 safety gates, pinned experiment manifests, signature `MONGODB_UNAVAILABLE` resilience proof.              | ✅ Done |
| **12** | **Recovery Verification (8 Paths)**   | Systematic automated validation of all 8 recovery scenarios from the system failure matrix.                       | ✅ Done |
| **13** | **Performance & Concurrency Lab**     | 100-aggregate concurrent scaling, OCC contention retry lab, 4 SQL inventory race prevention models.               | ✅ Done |
| **14** | **Security & DB Role Hardening**      | 6 MySQL database roles, immutable event triggers (`SIGNAL SQLSTATE '45000'`), MongoDB privileges.                 | ✅ Done |
| **15** | **Formal & Property Testing**         | Zero-dependency Mulberry32 property testing: sequence guard convergence, Kafka monotonicity, OCC race.            | ✅ Done |
| **16** | **Reproducibility & North-Star Demo** | Automated 8-act North-Star demonstration script, Rule Auditor engine, Docker production container, cloud configs. | ✅ Done |

---

## 6. Deep-Dive: Core Subsystems & Mechanisms

### 6.1 Event Sourcing, Dual-Sequencing & OCC

Every state change in CHRONOSCOPE is recorded as an immutable domain event in `chronoscope_core.events`. To balance per-aggregate OCC locking with global timeline order, two distinct sequence numbers are used (Rule 5):

1. **`aggregate_sequence`**: Contiguous integers ($1, 2, 3 \dots$) scoped to a specific aggregate on a timeline. Derived transactionally from `aggregate_versions.current_sequence` under a row lock (`SELECT ... FOR UPDATE`).
2. **`timeline_position`**: Monotonically increasing integers scoped to a timeline. Allocated from an AUTO_INCREMENT sequence table (`timeline_position_seq`), where gaps are expected and tolerated.

#### Three-Way Invariant (Rule 9)

In every event append transaction, the following equation holds true:
$$\text{aggregate\_versions.current\_sequence} == \text{aggregate\_state.aggregate\_sequence} == \max(\text{events.aggregate\_sequence})$$

Furthermore, the `aggregate_state` table holds an incrementally maintained materialized view of the state and its canonical SHA-256 hash `state_hash`.

```sql
-- Atomic Event Append (Simplified)
START TRANSACTION;
-- 1. Lock only the aggregate OCC anchor row (Rule 6)
SELECT current_sequence FROM chronoscope_core.aggregate_versions
WHERE timeline_id = ? AND aggregate_id = ? FOR UPDATE;

-- 2. Allocate timeline position via AUTO_INCREMENT table
INSERT INTO chronoscope_core.timeline_position_seq () VALUES ();
SET @pos = LAST_INSERT_ID();

-- 3. Append immutable domain event
INSERT INTO chronoscope_core.events (event_id, timeline_id, aggregate_id, aggregate_type,
  aggregate_sequence, timeline_position, event_type, schema_version, payload, causation_id, correlation_id, event_hash)
VALUES (?, ?, ?, ?, ?, @pos, ?, ?, ?, ?, ?, ?);

-- 4. Advance aggregate OCC version & update aggregate_state
UPDATE chronoscope_core.aggregate_versions SET current_sequence = ? WHERE timeline_id = ? AND aggregate_id = ?;
UPDATE chronoscope_core.aggregate_state SET aggregate_sequence = ?, state_payload = ?, state_hash = ?
WHERE timeline_id = ? AND aggregate_id = ?;

-- 5. Queue into transactional outbox
INSERT INTO chronoscope_core.outbox (event_id, partition_key, payload, status) VALUES (?, ?, ?, 'PENDING');
COMMIT;
```

---

### 6.2 The CQRS Pipeline & 3-Step Cross-Engine Commit

CHRONOSCOPE separates the write model (MySQL) from the read model (MongoDB). To prevent inconsistent read states across system crashes without distributed 2PC transactions, the system enforces a strict 3-step commit order (Rule 10):

1. **Step (a): Idempotent MongoDB Upsert**:
   - The projection worker writes to MongoDB collection `chronoscope_read.<projection>` using sequence guards:
   ```javascript
   db.order_summary.updateOne(
     {
       _id: `${timelineId}:${aggregateId}`,
       sourceAggregateSequence: { $lt: event.aggregate_sequence },
     },
     {
       $set: {
         ...projectedFields,
         sourceAggregateSequence: event.aggregate_sequence,
         projectionHash: computedHash,
       },
     },
     { upsert: true },
   );
   ```
2. **Step (b): MySQL Inbox & Checkpoint Commit**:
   - Updates `chronoscope_ops.projection_inbox` and `chronoscope_ops.projection_checkpoints` recording the event as processed.
3. **Step (c): Kafka Offset Commit**:
   - Commits the consumer offset to Kafka.

If a failure occurs between steps (a) and (b), Kafka redelivery triggers step (a) again, which safely no-ops due to the MongoDB sequence guard (`$lt`).

---

### 6.3 Zero-Downtime Projection Rebuild

When a read projection model evolves or requires cold recovery:

1. **Fencing (Rule 17)**: The rebuild controller acquires a MySQL advisory lock (`GET_LOCK('chronoscope:rebuild:<projection>', 10)`).
2. **Cutoff Point Selection**: The controller reads the maximum committed `timeline_position` in MySQL ($P_{\text{cutoff}}$) and stores it in `projection_rebuild_cutoffs`.
3. **Shadow Collection Build**: Events with $\text{timeline\_position} \le P_{\text{cutoff}}$ are replayed from MySQL into a temporary shadow collection (`order_summary_rebuild_<uuid>`).
4. **Hash Verification**: The controller computes the canonical hash of the shadow collection and verifies it against the source manifest.
5. **Atomic Swap**: The shadow collection is renamed to replace the live collection.
6. **Resume Live Ingestion**: Live projection workers process backlog events where $\text{timeline\_position} > P_{\text{cutoff}}$.

---

### 6.4 Deterministic Replay & Bit-for-Bit Hash Parity

CHRONOSCOPE guarantees that replaying history reproduces the exact business state bit-for-bit:

- **Canonical JSON Serialization**: Object keys sorted alphabetically, standard integer formatting, UTF-8 encoded.
- **State Hashing**: SHA-256 computed strictly over domain business state, excluding IDs and transport metadata.
- **Non-Circular Hash Proof**:
  - Live state calculates `aggregate_state.state_hash` during normal transactional execution.
  - Replay engine reconstructs state by folding pure domain events from genesis:
    $$\text{state} = \text{foldEvents}(\text{initialState}, \text{events})$$
  - The test suite asserts:
    $$\text{live\_hash} == \text{replay\_hash}$$
- **Snapshot Acceleration (Rule 14)**:
  - Snapshots stored in MinIO with metadata in MySQL `snapshot_sets`.
  - Replay loads the latest snapshot, verifies its `content_hash` via SHA-256, and replays only residual events.
  - If snapshot payload tampering or bit-rot is detected, the engine transparently falls back to raw event replay from genesis without error.

---

### 6.5 Timeline DAG & Counterfactual Branching

Timelines in CHRONOSCOPE form a Directed Acyclic Graph (DAG) rooted at `MAIN`:

- **Zero-Copy Branching (Rule 13)**: Creating a branch records a row in `chronoscope_core.timelines` with `parent_timeline_id` and `fork_position`. No parent events are copied.
- **Recursive Ancestor Resolution**: Historical state at the fork point is evaluated using recursive SQL:
  ```sql
  WITH RECURSIVE timeline_ancestry AS (
    SELECT timeline_id, parent_timeline_id, fork_position, 0 AS depth
    FROM chronoscope_core.timelines WHERE timeline_id = ?
    UNION ALL
    SELECT t.timeline_id, t.parent_timeline_id, t.fork_position, ta.depth + 1
    FROM chronoscope_core.timelines t
    JOIN timeline_ancestry ta ON t.timeline_id = ta.parent_timeline_id
  )
  SELECT * FROM timeline_ancestry ORDER BY depth DESC;
  ```
- **Counterfactual Scenarios (Rule 12)**:
  - Persisted in `chronoscope_core.scenario_inputs`.
  - Injects simulated behavior (e.g., forced payment failure, out-of-stock condition) exclusively on the child branch.
- **State Diff Engine**:
  - Compares the materialized state of an aggregate on `MAIN` versus a counterfactual branch.
  - Generates structural diffs (`field`, `mainValue`, `branchValue`, `divergenceReason`).

---

### 6.6 Causal Graph & Root-Cause Diagnosis

Every domain event carries causal tracing headers (Rule 5 & Phase 8):

- `event_id`: Unique identifier of the event.
- `causation_id`: ID of the command or direct predecessor event that caused this event.
- `correlation_id`: ID of the initial root command that initiated the entire workflow.

The **Causal Graph Engine**:

- Builds an in-memory directed graph of event relationships.
- Identifies three edge types:
  1. `CausationEdge`: Direct parent-child causality ($A \to B$).
  2. `TimelineAncestryEdge`: Causal bridge across a timeline fork point.
  3. `WorkflowEdge`: Orchestrated steps within a distributed saga.
- **Blast-Radius Analysis**: Calculates downstream dependent events affected if an event were invalidated.
- **Automated Root-Cause Analysis**: Backtracks upstream through causation edges to locate terminal failure triggers.
- **Visual Export**: Emits graph visualizations in DOT format and Mermaid syntax.

---

### 6.7 Asynchronous Background Jobs & RabbitMQ

Decoupled background tasks (e.g., snapshot generation, counterfactual simulations) run asynchronously (ADR-005 & Phase 9):

1. **Transactional Job Outbox**: Jobs inserted into `chronoscope_core.job_outbox` in the same MySQL transaction that modifies business state.
2. **Lease Worker**: Polls `job_outbox` using `SELECT ... FOR UPDATE SKIP LOCKED` and dispatches messages to RabbitMQ (`chronoscope.jobs`).
3. **Keyed Idempotency (Rule 8)**: Workers check `chronoscope_core.jobs` for `job_type + idempotency_key`. If already executed, workers return the cached `result_reference` without re-running side effects.
4. **Crash Recovery**: If a worker crashes mid-execution, RabbitMQ nacks/re-queues the message. The replacement worker re-reads the job record and executes with at-most-once persistent effects.

---

### 6.8 Fast Control Plane & NATS Core

The operational control plane coordinates workers with sub-millisecond latency (ADR-006 & Phase 10):

- **Desired State Broadcasting**:
  - Stored in MySQL `chronoscope_ops.worker_controls` with OCC version numbers (`version = version + 1`).
  - Broadcast over NATS Core subject `chronoscope.control.worker.<worker_type>.desired_state`.
- **Two-Phase Command Cancellation**:
  - Phase 1: `control_commands.status` set to `CANCELLATION_REQUESTED`.
  - Phase 2: Worker acknowledges cancellation, transitioning status to `CANCELLED`.
- **Self-Healing ControlReconciler**:
  - If a worker drops a NATS broadcast packet due to network partition, the background `ControlReconciler` periodically scans MySQL for state divergence and forces worker state convergence.

---

### 6.9 Chaos Engineering & Experiment Manifests

The Chaos Engine tests distributed resilience through structured fault injection (Rule 21 & 22):

#### Rule 21 Safety Gates

- `CHAOS_MODE=true` environment flag required; execution refused otherwise.
- RBAC authorization check requiring `admin` role.
- Max 5 concurrent active faults system-wide.
- Mandatory TTL auto-expiry on all injected faults.
- Atomic kill switch (`POST /chaos/kill-switch` or `chronoscope chaos abort`) immediately deactivating all faults.

#### Signature Fault Demonstrations

1. **`MONGODB_UNAVAILABLE` (Polyglot Resilience)**:
   - Read-side MongoDB is severed.
   - Write commands to MySQL continue succeeding with zero loss.
   - Outbox events buffer safely in Kafka.
   - Once MongoDB returns, projection workers drain the Kafka backlog and achieve 100% hash parity with MySQL.
2. **`MYSQL_UNAVAILABLE` (Read Availability)**:
   - MySQL is severed.
   - Write commands fail fast with typed `SYSTEM_ERROR` responses.
   - Read models in MongoDB continue serving queries uninterrupted.

---

### 6.10 The 8 Formal Disaster Recovery Paths

The laboratory formally proves recovery across 8 failure domains (Rule 23):

| Path  | Failure Scenario              | Recovery Mechanism & Guarantee                                                                                  |
| :---: | :---------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **1** | API crash before MySQL commit | Client retries safely; command deduplication ensures zero orphaned or duplicate state.                          |
| **2** | API crash after MySQL commit  | Transactional outbox background lease publisher guarantees at-least-once Kafka publishing.                      |
| **3** | Outbox worker crash mid-lease | Lease reaper reclaims expired leases (>30s) and reassigns them to healthy workers.                              |
| **4** | Duplicate Kafka delivery      | Read-side MySQL inbox (`projection_inbox`) absorbs redelivery; MongoDB sequence guard ignores duplicate upsert. |
| **5** | Total MongoDB collection drop | Cold rebuild from MySQL event store restores full query model and verifies collection hash parity.              |
| **6** | RabbitMQ job worker crash     | Job idempotency key ensures at-most-once persistent side effects upon task redelivery.                          |
| **7** | NATS dropped control packet   | Background `ControlReconciler` discovers state discrepancy in MySQL and forces worker convergence.              |
| **8** | Snapshot bit-rot / corruption | Replay engine detects SHA-256 mismatch and automatically falls back to raw event replay from genesis.           |

---

### 6.11 Concurrency Lab & 4 Inventory Allocation Strategies

Phase 13 models high-concurrency contention patterns and compares 4 SQL inventory allocation strategies:

1. **Uncontrolled Read-Modify-Write**:
   - `SELECT available`, application decrements in memory, `UPDATE available = new_val`.
   - **Result**: Classic lost updates; reliably oversells inventory under concurrency.
2. **Pessimistic Row Locking (`SELECT ... FOR UPDATE`)**:
   - Acquires exclusive row lock on the inventory record during evaluation.
   - **Result**: Fully serializes requests; zero oversell, but creates database lock queuing.
3. **Atomic Conditional Update**:
   - Executes `UPDATE inventory SET available = available - ? WHERE item_id = ? AND available >= ?`.
   - **Result**: Highly efficient single-statement atomicity; zero oversell, no application lock wait.
4. **Event-Sourced OCC with Jittered Retry**:
   - Appends `InventoryAllocated` event with version expectation; on conflict, retries with exponential backoff and decorrelated jitter.
   - **Result**: Zero oversell, zero row lock holding, produces an immutable audit log and deterministic hash parity.

---

### 6.12 Database Security & Role Hardening

Database security is enforced at the database engine level (Phase 14 & Rule 3):

#### MySQL Least-Privilege Roles

- `chronoscope_owner`: Schema DDL permissions for administration.
- `chronoscope_migrator`: Granted `GET_LOCK` and DDL permissions during migration execution.
- `chronoscope_app`: Granted `SELECT, INSERT, UPDATE` on business tables; `SELECT, INSERT` only on `events`.
- `chronoscope_projection_worker`: Granted read access on outbox and events; write access only to `projection_checkpoints` and `projection_inbox`.
- `chronoscope_rebuild_controller`: Granted permissions to create/swap rebuild collections and acquire advisory locks.
- `chronoscope_publisher`: Granted outbox lease update permissions.

#### Database Immutability Triggers

MySQL database triggers actively block modifications on event logs regardless of user role:

```sql
CREATE TRIGGER trg_events_prevent_update
BEFORE UPDATE ON chronoscope_core.events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ChronoscopeRule3Violation: domain events are strictly immutable.';
END;
```

---

### 6.13 Generative Property Testing Engine

Phase 15 provides a zero-dependency generative property testing framework (`packages/testing/src/property/`) powered by a seedable **Mulberry32 PRNG**:

- **Property 1 (Mongo Sequence Guard Convergence)**:
  - Proves that arbitrary message reorderings, duplicates, and burst injections always converge to bit-for-bit identical state and `projectionHash`.
- **Property 2 (Kafka Checkpoint Monotonicity)**:
  - Proves that arbitrary out-of-order deliveries maintain a contiguous, monotonic high-water mark without checkpoint regression.
- **Property 3 (Racing Appends OCC Invariant)**:
  - Proves that across $W \in [2, 20]$ racing writers with `expectedSequence = 0`, exactly 1 succeeds and $W-1$ receive `ConcurrencyError`.
- **Property 4 (Dual-Sequencing Monotonicity)**:
  - Proves that across arbitrary multi-aggregate append workloads, `aggregate_sequence` is contiguous per aggregate while `timeline_position` is monotonically strictly increasing across the timeline.

---

## 7. API Specification & Endpoints

The Fastify API server (`apps/api`) exposes REST endpoints documented via OpenAPI:

### Health & Readiness Probes

- `GET /health/live`: Basic liveness probe.
- `GET /health/version`: Build version, Git SHA, and environment mode.
- `GET /health/ready/write`: Validates write-side MySQL and Redis connectivity.
- `GET /health/ready/read`: Validates read-side MongoDB connectivity.

### CQRS Commands & Queries

- `POST /commands/order`: Submits an order command (`CreateOrder`, `ConfirmOrder`, `CancelOrder`) with `X-Command-Id` header for deduplication.
- `GET /queries/orders/:id`: Fetches denormalized order summary from MongoDB read store.
- `GET /queries/orders`: Queries order summaries with pagination.

### Timelines & DAG Operations

- `POST /timelines/fork`: Forks a new timeline branch (`parentTimelineId`, `forkPosition`, `name`).
- `GET /timelines/:id`: Retrieves timeline metadata and DAG position.
- `GET /timelines/:id/ancestors`: Traverses timeline parent hierarchy via recursive SQL.
- `POST /timelines/:id/diff`: Compares state between two timelines and reports attribute divergence.

### Replay & Snapshots

- `POST /replay/live`: Triggers read-only deterministic replay against live MySQL state.
- `POST /replay/counterfactual`: Triggers counterfactual replay on a branch timeline with scenario inputs.
- `POST /snapshots`: Generates a content-addressable snapshot uploaded to MinIO.
- `GET /snapshots/:aggregateId`: Retrieves snapshot metadata and verification status.

### Causal Graph Analysis

- `GET /causal/trace/:eventId`: Traces causation and correlation graph for an event.
- `GET /causal/blast-radius/:eventId`: Calculates downstream impacted events.
- `GET /causal/export`: Exports timeline causal graph in Mermaid or DOT format.

### Background Jobs & Control Plane

- `POST /jobs`: Submits an asynchronous background task.
- `GET /jobs/:id`: Polls job status and execution result reference.
- `POST /controls/worker-state`: Updates worker desired state (`ACTIVE`/`PAUSED`) via NATS.
- `POST /controls/commands`: Dispatches durable one-shot control commands.

### Chaos Lab & Experiments

- `POST /chaos/inject`: Injects a fault configuration (`faultType`, `target`, `durationMs`, `params`).
- `POST /chaos/kill-switch`: Immediately halts and purges all active chaos faults.
- `POST /experiments/run`: Executes an automated resilience experiment from a pinned manifest.
- `GET /experiments`: Lists experiment execution histories and results.

---

## 8. Interactive Web Dashboard (9 Pages)

The React web application (`apps/web`) provides visual interfaces for inspecting and interacting with the laboratory:

1. **Overview Page (`/`)**: Real-time system topology, active connections, event throughput counters, and service health indicators.
2. **Command Center (`/command-center`)**: Interactive command dispatcher for submitting Order and Payment domain commands and inspecting event generation.
3. **Replay Lab (`/replay-lab`)**: Visual live-replay execution verifying hash parity against live state in real-time.
4. **Timeline Diff Page (`/timeline-diff`)**: Visual DAG tree browser and side-by-side branch state diff visualizer.
5. **Causal Graph Page (`/causal-graph`)**: Interactive node-link causal graph visualizing causation, correlation, and workflow edges.
6. **Chaos Lab (`/chaos-lab`)**: Fault injection control deck, active fault monitors, and emergency kill switch.
7. **Concurrency Lab (`/concurrency-lab`)**: Interactive benchmark dashboard comparing the 4 SQL inventory race allocation strategies.
8. **Rule Auditor Page (`/rule-auditor`)**: Interactive test runner executing quick/deep architectural audits against the 25 rules.
9. **Health Page (`/health`)**: Fine-grained health monitor displaying write-read split availability status.

---

## 9. CLI Command Suite (17 Commands)

The CLI tool (`apps/cli`, aliased as `chronoscope`) provides complete operator control:

```bash
# System Diagnostics & Verification
chronoscope doctor                    # Inspects health of MySQL, Redis, Mongo, Kafka, RabbitMQ, NATS
chronoscope audit --quick             # Live-tolerant verification of 25 architecture rules
chronoscope audit --deep              # Quiesced, strict audit yielding cryptographic SHA-256 proof
chronoscope token --role <role>       # Mints local development JWTs for testing (admin, researcher, operator)

# North-Star Full Laboratory Demo
chronoscope demo                      # Executes the automated 8-act end-to-end system demonstration

# Replay, Snapshots & DAG
chronoscope replay live <aggregateId>               # Executes live replay and validates state hash parity
chronoscope replay counterfactual <timelineId>      # Executes counterfactual replay with scenario inputs
chronoscope snapshot create <aggregateId>           # Captures content-addressable MinIO snapshot
chronoscope fork <parentTimelineId> <forkPosition>  # Forks a zero-copy child timeline
chronoscope diff <timelineA> <timelineB>            # Evaluates attribute state divergence between branches

# Causal Tracing & Projections
chronoscope causal trace <eventId>                  # Traces causal lineage and root cause
chronoscope rebuild-projection <projectionName>     # Executes zero-downtime MongoDB projection rebuild

# Control Plane & Jobs
chronoscope control pause <workerType>              # Broadcasts PAUSED state via NATS
chronoscope control resume <workerType>             # Broadcasts ACTIVE state via NATS
chronoscope job submit <jobType> <payloadJson>      # Dispatches an asynchronous job to RabbitMQ

# Chaos & Performance Benchmarking
chronoscope chaos inject <faultType>                # Injects fault under Rule 21 safety gates
chronoscope chaos abort                             # Activates emergency kill switch
chronoscope experiment run <experimentManifest>     # Executes reproducible experiment from manifest
chronoscope bench concurrency                       # Runs concurrent scaling and OCC contention benchmarks
```

---

## 10. Docker Compose & Cloud Deployment

### Multi-Container Docker Compose Stack

The stack is managed via `docker-compose.yml`:

- **`mysql`**: MySQL 8.4 LTS (`innodb_autoinc_lock_mode=2` pinned via `infrastructure/docker/mysql/my.cnf`).
- **`mongo`**: MongoDB 7.0 Community Edition (gated behind `--profile mongo`).
- **`redis`**: Redis 7 Alpine ephemeral cache.
- **`kafka` & `zookeeper`**: Apache Kafka event streaming backbone.
- **`rabbitmq`**: RabbitMQ 3 Management work queue.
- **`nats`**: NATS Core high-performance message broker.
- **`minio`**: MinIO S3-compatible content-addressable blob store.

### Cloud Deployment Blueprints

- **Render (`render.yaml`)**:
  - `chronoscope-api`: Web service running Fastify API.
  - `chronoscope-worker`: Background worker processing RabbitMQ jobs and NATS control signals.
  - `chronoscope-projection-worker`: CQRS worker synchronizing Kafka events to MongoDB.
  - Fully managed MySQL, MongoDB, and Redis instances.
- **Vercel (`vercel.json`)**:
  - Edge SPA hosting for `apps/web`.
  - Secure reverse-proxy rewrites routing `/api/*` to Render web services.
- **Dockerfile**:
  - Multi-stage, minimal Alpine Node.js 24 non-root production container.

---

## 11. Developer Quickstart & Verification

### Prerequisites

- Node.js >= 24.0.0
- npm >= 10.0.0
- Docker Desktop (for live containerized infrastructure)

### Installation & Infra-Free Testing

All 54 test suites and 182 unit/golden tests run **100% infra-free** using in-memory mock repositories and Mulberry32 simulators:

```bash
# 1. Install dependencies across all monorepo workspaces
npm install

# 2. Run typecheck across the monorepo
npm run typecheck

# 3. Run linting and code style checks
npm run lint
npm run format:check

# 4. Execute all 182 tests (sub-second execution, no Docker required)
npm test
```

### Starting Live Local Infrastructure

```bash
# 1. Start core persistence infrastructure (MySQL + Redis)
make infra

# 2. Start full polyglot stack (MySQL + Redis + MongoDB)
make infra-mongo

# 3. Apply schema migrations
npm run migrate --workspace=packages/database

# 4. Run mode-aware health doctor
make doctor

# 5. Start Fastify API server in development mode
make dev

# 6. Run automated architectural audit
make audit
```

### Running the North-Star Demonstration

To run the complete automated 8-act end-to-end demonstration verifying all system invariants, run:

```bash
npx tsx apps/cli/src/index.ts demo
```

---

_CHRONOSCOPE is designed and maintained as a deterministic distributed-systems laboratory._
