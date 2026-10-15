# Failure Matrix

_Filled in incrementally as each recovery scenario is implemented (Phase 12 is where most of this gets exercised end-to-end). One row per failure scenario._

| Failure                                                      | Expected result                                | Recovery                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| API crashes before MySQL commit                              | No event persisted                             | None needed — client retries the command                                                                        |
| API crashes after MySQL commit, before outbox publish        | Event durable, outbox row `PENDING`            | Outbox publisher picks it up on restart                                                                         |
| Outbox publisher crashes mid-lease                           | Row stuck `LEASED`                             | Lease reaper resets to `PENDING` after `lease_until` expires                                                    |
| Kafka publish succeeds, lease-mark-published fails           | Possible duplicate publish                     | Downstream inbox dedup absorbs it                                                                               |
| Mongo upsert succeeds, MySQL inbox commit fails              | Mongo ahead of MySQL bookkeeping               | Kafka redelivers; Mongo upsert no-ops (sequence guard), MySQL inbox succeeds                                    |
| MySQL inbox commit succeeds, Kafka offset commit fails       | Redelivery-safe                                | Inbox duplicate check skips re-applying to Mongo                                                                |
| MongoDB document/collection lost _after_ checkpoint advanced | **Not** repairable by Kafka redelivery         | `chronoscope rebuild-projection` (Phase 5/12)                                                                   |
| RabbitMQ worker crashes before SQL job-state commit          | Redelivery                                     | `jobs.idempotency_key` proves at-most-once effect                                                               |
| NATS control message lost                                    | `control_commands` row stays `PENDING`         | Reconciler re-notifies                                                                                          |
| Snapshot object lost from MinIO                              | Detected via `content_hash` mismatch           | Replay from `events`                                                                                            |
| `aggregate_state` corrupted                                  | Three-way invariant mismatch detected by audit | Replay from `events` rebuilds it                                                                                |
| MySQL itself lost                                            | Authoritative data loss                        | `mysqldump --single-transaction` restore, RPO = time since last backup                                          |
| Rebuild controller crashes mid-swap                          | `projection_rebuild_runs` stuck `SWAPPING`     | Recovery checks target collection's actual hash against the stored run record to decide resume/finalize/restart |

See `docs/spec/system-guarantees.md` rule 23 for the eight formal recovery paths.
