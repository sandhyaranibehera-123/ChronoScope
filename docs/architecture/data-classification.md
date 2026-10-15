# Data Classification

Per data store: is it durable, is it the source of truth, is it rebuildable?

| Store                                                         | Durable?               | Source of truth?                                | Rebuildable?                             |
| ------------------------------------------------------------- | ---------------------- | ----------------------------------------------- | ---------------------------------------- |
| MySQL `chronoscope_core.events`                               | Yes                    | **Yes — authoritative**                         | No                                       |
| MySQL `aggregate_state`                                       | Yes                    | No — materialization                            | Yes, from events                         |
| MySQL `chronoscope_ops.*` (jobs, experiments, audit, control) | Yes                    | Yes (its own domain: operational record)        | No                                       |
| MongoDB `chronoscope_read.*`                                  | Yes (within Mongo)     | **No — disposable**                             | Yes, from MySQL events                   |
| Kafka                                                         | Yes (retention window) | No — distribution only                          | Reconstructible from the outbox          |
| RabbitMQ                                                      | Yes (in-flight)        | No — delivery only                              | Reconstructible from `jobs`/`job_outbox` |
| NATS                                                          | No                     | No — transport only                             | N/A                                      |
| Redis                                                         | No                     | No — never correctness                          | Yes (nothing to lose)                    |
| MinIO                                                         | Yes                    | No — artifact payloads, metadata lives in MySQL | Regeneratable from source data           |

_(Full detail arrives Phase 16 alongside `chronoscope report`; this table already reflects the frozen architecture decisions from Phase 1.)_
