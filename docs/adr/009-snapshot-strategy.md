# ADR-009: Snapshots as an optimization, never the source of truth

**Status**: Accepted (implemented Phase 6)

**Context**: Full replay from `events` is always correct but not always fast; snapshots need to accelerate replay without ever becoming a second source of truth.

**Decision**: Snapshots exist at two scopes (per-aggregate `snapshots`, timeline-level `snapshot_sets`), metadata in MySQL, payload in MinIO, captured as a consistent cut via `START TRANSACTION WITH CONSISTENT SNAPSHOT`. A snapshot's `status` only becomes `READY` after its object and `content_hash` are verified.

**Consequences**: A lost or corrupted snapshot is always recoverable by replaying from `events` — demonstrated explicitly as a Phase 12 recovery scenario.
