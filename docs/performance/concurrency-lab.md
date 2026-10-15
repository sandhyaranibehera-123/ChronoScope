# Performance & Concurrency Lab (Phase 13)

This document details the architecture, experimental methodologies, benchmark results, and concurrency controls of CHRONOSCOPE's Performance & Concurrency Lab.

---

## 1. Concurrency Control Architecture Overview

CHRONOSCOPE proves concurrency guarantees through four distinct performance and resilience benchmarks:

1. **High-Throughput Independent Scaling (Rule 6)**:
   - Event appends lock _only_ the specific aggregate row in `chronoscope_core.aggregate_versions` via `SELECT ... FOR UPDATE`, never a timeline-wide table lock.
   - Dual-sequencing uses `innodb_autoinc_lock_mode = 2` (interleaved mode) on `chronoscope_core.timeline_position_seq`, ensuring lock contention on sequence generation is non-blocking.
   - Independent aggregates scale concurrently with zero lock contention.

2. **Hot-Spot OCC Contention & Exponential Backoff Convergence**:
   - When multiple concurrent processes race to modify the same aggregate instance, exactly one writer claims the current sequence version slot.
   - Stale writers receive `ConcurrencyError` (`ERR_CONCURRENCY_CONFLICT`).
   - Using full-jitter exponential backoff (`backoff = min(100ms, base * 1.5^attempt) + jitter`), contending writers re-read authoritative state and retry, converging 100% to sequence $N$ without lost updates or corruption.

3. **Inventory Allocation Concurrency Lab (4 Strategies)**:
   - Demonstrates the classic distributed inventory allocation and overselling problem across 4 concurrency control strategies:
     1. **Uncontrolled Read-Modify-Write**: Vulnerable to Lost Updates. Demonstrates that simultaneous reads of available inventory cause multiple orders to be confirmed against the same stock, leading to negative inventory and severe overselling.
     2. **Pessimistic Row Locking (`SELECT ... FOR UPDATE`)**: Acquires an exclusive row-level lock on the target SKU row before reading. Subsequent requests queue up on the lock. Guarantees zero overselling, but introduces serialization latency under high contention.
     3. **Atomic SQL Conditional Update (`UPDATE ... WHERE available >= ?`)**: Evaluates stock and deducts in a single atomic SQL statement without holding an open transaction before the check. Ultra-low latency, zero overselling, high throughput.
     4. **Event-Sourced OCC**: The canonical Chronoscope model. Loads aggregate version, evaluates business invariants in memory (pure domain function), appends `InventoryReserved` event with `expected_sequence`. Stale writers retry with backoff. Guarantees zero overselling, immutable audit trails, and bit-for-bit state hash parity.

4. **Mongo 3-Step Commit Latency & Projection Lag Profiling (Rule 10)**:
   - Profiles the three decoupled stages of the CQRS ingestion pipeline:
     - **Stage 1 (MySQL Event Store Append)**: `events` + `aggregate_versions` + `aggregate_state` + `outbox`.
     - **Stage 2 (Outbox Lease & Kafka Dispatch)**: Lease acquisition (`SKIP LOCKED`) and Kafka message publication.
     - **Stage 3 (MongoDB Read Store Commit)**: Idempotent sequence-guarded MongoDB write (`w:1, j:true`) + MySQL `inbox` deduplication + `projection_checkpoints` advancement.
   - Verifies write-path decoupling: Stage 1 performance remains sub-millisecond even when read-side ingestion experiences latency.

---

## 2. Inventory Strategies Comparison Matrix

| Strategy                    | Mechanism                           | Race Safety (Overselling)                 | Latency Profile                     | Scalability      | Replay Determinism           |
| :-------------------------- | :---------------------------------- | :---------------------------------------- | :---------------------------------- | :--------------- | :--------------------------- |
| **1. Uncontrolled RMW**     | `SELECT` then `UPDATE`              | ❌ **Oversells Stock** (Lost Update bug)  | Low (misleading)                    | Poor correctness | None                         |
| **2. Pessimistic Row Lock** | `SELECT ... FOR UPDATE`             | ✅ **0 Oversold** (Strict FIFO Queue)     | High under contention ($O(N)$ wait) | Low on hot SKUs  | No event history             |
| **3. Atomic SQL Update**    | `UPDATE ... WHERE avail >= ?`       | ✅ **0 Oversold** (Engine Atomic CAS)     | Sub-millisecond                     | Very High        | No event history             |
| **4. Event-Sourced OCC**    | Append `InventoryReserved` with OCC | ✅ **0 Oversold** (Version Check + Retry) | Low-Medium (Backoff Convergence)    | High across keys | ✅ Full Replay & Hash Parity |

---

## 3. Benchmark CLI Commands

```bash
# Run all four performance and concurrency benchmarks
chronoscope bench --suite all

# Run specific benchmarks
chronoscope bench --suite scaling --count 100
chronoscope bench --suite occ --concurrency 50
chronoscope bench --suite inventory
chronoscope bench --suite mongo
```

---

## 4. Verification

Phase 13 benchmarks are verified hermetically via Vitest:

```bash
npx vitest run tests/performance/concurrency-lab.test.ts
```

All 8 tests verify:

- Independent aggregate scaling with zero lock contention.
- Raw OCC single-winner isolation and 100% retry convergence.
- Demonstrating the failure of Uncontrolled Read-Modify-Write (reproducing oversell bug).
- Strict correctness of Pessimistic, Atomic, and Event-Sourced OCC strategies.
- Decoupled CQRS 3-stage latencies and projection lag percentiles ($p50, p95, p99$).
