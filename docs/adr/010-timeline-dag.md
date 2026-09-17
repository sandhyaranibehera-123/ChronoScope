# ADR-010: Timeline branching without copying history

**Status**: Accepted (implemented Phase 7)

**Context**: Counterfactual execution ("what if payment had failed?") needs to fork a timeline cheaply and keep branches isolated, without the storage/complexity cost of duplicating events.

**Decision**: A branch stores only `fork_position` and its own local events; effective history is resolved recursively (`EffectiveHistory(B) = EffectiveHistory(parent, ≤fork_position) + LocalEvents(B)`) via a `WITH RECURSIVE` CTE — see `docs/architecture/timeline-semantics.md`.

**Consequences**: Fork creation is cheap and instantaneous; branch isolation (siblings never see each other, cycles are structurally impossible) is provable from the schema itself.
