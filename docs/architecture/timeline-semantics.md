# Timeline Semantics

*Stub — the full recursive-CTE implementation and nested/sibling-branch test suite land in Phase 7. The formal definitions below are frozen now so Phase 7 implements against a spec, not a blank page.*

## Branches never copy parent history

For a branch `B` with parent `P` and `fork_position = F`:

```
EffectiveHistory(B) = EffectiveHistory(P, ≤F) + LocalEvents(B, timeline_id=B)
```

— recursively for nested branches. Resolved via a `WITH RECURSIVE` CTE over `parent_timeline_id`, never a naive `position <= branch.head` filter (branch and parent `timeline_position` values can numerically overlap, since both draw from the same shared `timeline_position_seq`).

## Branch-local aggregate sequence

`aggregate_sequence` is local to its own `(timeline_id, aggregate_id)` stream and is never inherited across a fork. A branch's copy of an aggregate initializes at `aggregate_sequence = 0` with `state = EffectiveHistory(parent, ≤fork_position)` already folded in; its first branch-local event advances the sequence to 1.

## Sibling isolation

For `BRANCH-A` and `BRANCH-B` forked from the same parent, `EffectiveHistory(A)` never includes `BRANCH-B`'s local events, or vice versa.

## Fork position validation

`fork_position = 0` is valid (forking an empty timeline). `0 <= fork_position <= COALESCE(MAX(parent.events.timeline_position), 0)`, checked transactionally against the parent's actual history at fork time.

## Counterfactuals enter through `ScenarioInput`, never a raw injected event

A `ScenarioInput` (e.g. `ForcePaymentFailure`) is persisted in `scenario_inputs` before domain execution — an experiment instruction, never a hand-written domain event. The domain turns it into real, validated branch-local events.
