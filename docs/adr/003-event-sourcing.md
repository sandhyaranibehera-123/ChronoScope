# ADR-003: Event sourcing for the domain model

**Status**: Accepted

**Context**: The project's north-star demonstrations (deterministic replay, timeline branching, causal analysis, recovery-from-history) all require the full history of what happened, not just current state.

**Decision**: Every domain state change is captured as an immutable event in MySQL `events`, with `aggregate_state` as a rebuildable materialization of current state, never the source of truth itself.

**Consequences**: Every other capability in the project (Phase 6 replay, Phase 7 branching, Phase 8 causal graph, Phase 12 recovery) is a direct consequence of this one decision.
