# ADR-008: Deterministic replay via `ExecutionContext`

**Status**: Accepted (implemented Phase 6)

**Context**: Proving "replay produces the same state as live execution" requires domain code to never depend on uncontrolled wall-clock time, randomness, or transport identity.

**Decision**: `ExecutionContext` splits `HistoricalClock` (an event uses its own `occurred_at`) from `ExecutionClock` (a new event uses real or deterministic-logical time); seed derivation excludes the volatile `execution_id` and includes a per-experiment `scenarioSeed`; canonical JSON + canonical numeric representation (integer minor units, never floats) feed every hash.

**Consequences**: Live hash (`aggregate_state.state_hash`) and independently-computed replay hash are directly comparable — the project's core correctness proof (Phase 6, dedicated session).
