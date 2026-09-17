# ADR-015: Why not a Redis lock

**Status**: Accepted

**Context**: Redis is present in the stack (rate limiting, ephemeral cache, worker heartbeat) and it would be technically possible to use `SET NX`-style locks for event-append or inventory-reservation correctness.

**Decision**: Redis is never used as a correctness mechanism. Event-append and inventory-reservation correctness are owned entirely by MySQL — row locks, OCC (`aggregate_versions`), and `SERIALIZABLE` isolation where the concurrency lab specifically demonstrates it (Phase 13). Cross-engine coordination fences (Phase 5's rebuild-vs-worker fence) use MySQL's own `GET_LOCK()`/`RELEASE_LOCK()`, not Redis.

**Consequences**: There is exactly one failure domain for write-side correctness invariants — MySQL — never two independent locking systems that could disagree.
