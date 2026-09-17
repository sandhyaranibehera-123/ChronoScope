# ADR-001: Modular monolith first, not 15 microservices

**Status**: Accepted

**Context**: CHRONOSCOPE's subject is distributed-systems properties (consistency, concurrency, determinism, causality, delivery, failure, recovery), not service-oriented decomposition for its own sake.

**Decision**: Start as a modular monolith (`apps/*`, `packages/*` with clean interfaces), extracting a service only where distribution itself is the point of an experiment (e.g. `apps/replay-worker` in Phase 9, once gRPC has a genuine synchronous-RPC need). Nothing is scaffolded ahead of the phase that gives it a real responsibility.

**Consequences**: Faster iteration, fewer deployment concerns, and a Git history where every new package/app corresponds to a real capability landing — not "20 services that are really just 20 processes."
