# Invariant → Enforcement Mechanism

_Filled in incrementally as each phase lands the mechanism it depends on. One row per invariant._

| Invariant                                | Enforcement mechanism                                                                   | Phase            |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ---------------- |
| Events are immutable                     | DB grants (`SELECT,INSERT` only) + `BEFORE UPDATE`/`DELETE` trigger                     | 3, 14            |
| `aggregate_sequence` contiguous, no gaps | Row lock on `aggregate_versions` + single transaction                                   | 3                |
| No timeline-wide lock on append          | `timeline_position_seq` AUTO_INCREMENT-table allocator, `innodb_autoinc_lock_mode=2`    | 1, 3             |
| Unique event identity                    | `PRIMARY KEY(event_id)` + named `UNIQUE KEY`s                                           | 3                |
| Projection effect idempotent             | Inbox `PRIMARY KEY(event_id, consumer_name)` + Mongo sequence-guarded upsert            | 4                |
| Branch isolation                         | `timeline_id` FK + recursive CTE + no history copy                                      | 7                |
| Replay deterministic                     | `ExecutionContext` (Historical/ExecutionClock split) + canonical hash                   | 6                |
| Command idempotent                       | `command_deduplication` PRIMARY KEY(`command_id`)                                       | 5                |
| Job effect idempotent                    | `jobs` unique `(job_type, idempotency_key)` + `result_reference`                        | 9                |
| Worker desired state durable             | `worker_controls` + OCC version                                                         | 10               |
| Control command idempotent               | `control_commands` PRIMARY KEY(`command_id`)                                            | 10               |
| Snapshot integrity                       | `content_hash` verified before `READY`                                                  | 6                |
| MySQL recoverable                        | `mysqldump --single-transaction` backup/restore                                         | 12               |
| Projection worker write boundary         | Split MySQL roles (`chronoscope_projection_worker` vs `chronoscope_rebuild_controller`) | 14               |
| Rebuild race-free                        | Per-`(projection,partition)` MySQL advisory fence, ascending acquisition order          | 17 rule, Phase 5 |

See `docs/spec/system-guarantees.md` for the full rule text behind each row.
