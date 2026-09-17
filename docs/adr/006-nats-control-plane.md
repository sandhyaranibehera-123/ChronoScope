# ADR-006: NATS as control-plane transport only

**Status**: Accepted (implemented Phase 10)

**Context**: Operational commands (pause/resume a worker, start/cancel a replay or chaos run) are not domain events and must never be confused with them.

**Decision**: NATS carries desired-state notifications (`worker_controls`, OCC-versioned) and durable one-shot commands (`control_commands`, idempotent by `command_id`) — both durably recorded in MySQL first. NATS itself is transport only; a lost NATS message never loses a command, since a reconciler re-notifies from the durable MySQL record.

**Consequences**: Control-plane messages never enter the `events` table.
