# ADR-011: gRPC for exactly one thing — API ⇄ replay-worker

**Status**: Accepted (implemented Phase 9)

**Context**: Once `apps/replay-worker` exists as an independent process (Phase 9), the API needs a synchronous way to trigger and check on a replay/branch execution without blocking on bulk results.

**Decision**: gRPC's _only_ responsibility in this project is that one call, with an explicit deadline, request/correlation IDs, health check, and a versioned contract-tested proto — returning `{executionId, stateHash, summary}`, never streaming bulk replay output inline (large artifacts live in MinIO).

**Consequences**: gRPC is never introduced "wherever it might fit" — this is its one decided, frozen use, chosen precisely for the point where a synchronous internal call is actually needed.
