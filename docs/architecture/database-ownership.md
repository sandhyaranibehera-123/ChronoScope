# Database Ownership

Two engines, each earning its place for a specific reason — see `docs/spec/system-guarantees.md` for why the event store stays on MySQL rather than moving to MongoDB.

## Schemas

- **MySQL** `chronoscope_core`: `schema_migrations`, `timelines`, `timeline_position_seq`, `events`, `system_events`, `aggregate_versions`, `aggregate_state`, `outbox`, `snapshots`, `snapshot_sets`, `users`, `refresh_sessions`. *(Only `schema_migrations` exists as of Phase 1 — the rest land in Phase 3/6/14.)*
- **MySQL** `chronoscope_ops`: `command_deduplication`, `jobs`, `job_outbox`, `worker_controls`, `control_commands`, `executions`, `scenario_inputs`, `experiments`, `experiment_runs`, `experiment_invariants`, `audit_log`, `inbox`, `projection_checkpoints`, `projection_metadata`, `projection_rebuild_runs`, `projection_rebuild_cutoffs`. *(Created empty by migration `0001_databases.sql`; tables land per-phase — Phase 4/5/9/10/11.)*
- **MongoDB** `chronoscope_read`: collections `order_summary`, `payment_summary`, `shipment_summary` — one document per `(timeline_id, aggregate_id)` pair, never per `aggregate_id` alone. *(Does not exist until Phase 4 — `packages/read-store` is created then.)*

## MySQL role matrix

*(Roles themselves are provisioned in Phase 14 — Phase 1 uses `root` for migrations and a single `chronoscope_app` user for the health check, documented as a deliberate, honest simplification until role separation is enforced.)*

| Role | events/system_events | timelines/aggregate_versions/aggregate_state | outbox/job_outbox | timeline_position_seq | `inbox`/`projection_checkpoints` | `projection_metadata`/`projection_rebuild_runs`/`projection_rebuild_cutoffs` | rest of `chronoscope_ops` | DDL |
|---|---|---|---|---|---|---|---|---|
| `chronoscope_app` | SELECT, INSERT | SELECT, INSERT, UPDATE | INSERT | INSERT, SELECT | — | — | SELECT, INSERT, UPDATE | — |
| `chronoscope_projection_worker` | SELECT | SELECT | — | — | SELECT, INSERT, UPDATE | SELECT only | — | — |
| `chronoscope_rebuild_controller` | SELECT | SELECT | — | — | — | SELECT, INSERT, UPDATE | — | — |
| `chronoscope_publisher` | — | — | SELECT, UPDATE | — | — | — | — | — |
| `chronoscope_migrator` | — | — | — | — | — | — | — | DDL |
| `chronoscope_owner` | * | * | * | * | * | * | * | * |

`chronoscope_projection_worker` and `chronoscope_rebuild_controller` are split specifically so rule 17's "worker may never write `projection_metadata`" is database-enforced, not merely conventional.

## Read/write ownership matrix

| Component | MySQL read | MySQL write | Mongo read | Mongo write |
|---|---|---|---|---|
| API command path | `aggregate_state` | core + command dedup | ✗ | ✗ |
| Query API | ✗ | ✗ | own read model | ✗ |
| Projection worker | `timelines`, `events`, `aggregate_versions`, `aggregate_state`, `projection_metadata` (read-only) | `inbox`, `projection_checkpoints` only | own collection | own collection only |
| Replay worker | core/ops replay inputs | execution/replay metadata | ✗ | ✗ |
| Rebuild controller/CLI | events/state/timelines + cutoff metadata | `projection_metadata`, `projection_rebuild_runs`, `projection_rebuild_cutoffs` | shadow/target (verify) | shadow + target |
| Admin/audit | MySQL operational data | audit tables | read only | ✗ |

A projection worker reading MySQL history for fork-base-state/lagging-hash reconstruction is a **read-only reconstruction input** — it never transfers business-state authority to the projection worker.

## Read-side delivery contract

Consume Kafka event → compute projection state → durably commit the MongoDB write (`w:1,j:true`) → commit the MySQL inbox+checkpoint transaction → commit the Kafka offset — never any other order. **This is not a distributed transaction** — no two-phase commit spans MySQL/MongoDB/Kafka; correctness comes from durable ordering + idempotent, sequence-guarded writes + full rebuildability.

**Ownership, stated plainly**: MySQL owns authoritative business truth; Kafka owns durable delivery transport; MongoDB owns disposable materialized read state; MySQL's `inbox`/`projection_checkpoints` own authoritative processing bookkeeping. Loss of MongoDB data ≠ loss of business truth. Loss of Kafka delivery state ≠ loss of business truth. Loss of MySQL event history = an authoritative data-loss scenario requiring MySQL recovery.

## Advisory-lock ownership

The projection worker and rebuild controller both take a `GET_LOCK(<bounded-name>, timeout)` MySQL advisory fence around the `ACTIVE`-status check and the write it gates. These locks are **coordination primitives, not durable state** — the authoritative record of "is this projection currently rebuildable-safe" is always `projection_metadata.status`.

## Mongo `rebuild_projection` role privileges (Phase 14)

On the fixed shadow collection (`order_summary__rebuild` etc.) — `find`, `insert`, `update`, `remove`, plus create/index privileges. On the live target collection — `find` and `dropCollection` (for `dropTarget:true`). At the database level — `renameCollectionSameDB`. Deliberately **not** a blanket `readWrite` on `chronoscope_read`.
