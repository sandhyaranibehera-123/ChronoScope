# ID Semantics

CHRONOSCOPE has many identifiers. Do not substitute one for another — each has a distinct scope and purpose.

```
request_id        → one HTTP call
command_id         → one logical command (dedup key)
event_id            → one immutable event (durable identity)
correlation_id       → one business workflow, stable across it
causation_id          → the direct parent event (NULL only for a workflow-root event)
execution_id/           → tracking/audit only — NEVER correctness or determinism
experiment_id/run_id
timeline_id             → one timeline (MAIN or a branch)
aggregate_id              → one aggregate, scoped to a timeline — see below
job_id                     → one job
```

## Aggregate identity is `(timeline_id, aggregate_id)`, never `aggregate_id` alone

A branch can hold the same `aggregate_id` as MAIN while representing genuinely different state (Phase 7 counterfactual execution). Every place that keys off "which aggregate" — `aggregate_versions`, `aggregate_state`, and critically the **MongoDB projection document `_id`** — uses the composite `(timeline_id, aggregate_id)`, rendered as `` `${timelineId}:${aggregateId}` `` for the Mongo `_id`. Keying by `aggregateId` alone would let MAIN's and a branch's projections silently collide and overwrite each other.

## Two sequence numbers — never interchange

- `aggregate_sequence` — scope: one `(timeline_id, aggregate_id)`; derived from the locked `aggregate_versions.current_sequence` row; contiguous for committed events; used for OCC.
- `timeline_position` — scope: one `timeline_id`; allocated from `timeline_position_seq`; gaps expected; a logical ordering key, **not** causal order.

Causal order is `causation_id → event_id` alone — never a proxy via either sequence number.

## Read-side progress fields (MongoDB documents, from Phase 4)

```
appliedSequence          → aggregate-local projection progress (matches aggregate_sequence)
appliedTimelinePosition   → for cross-engine audit correlation
appliedKafkaTopic/Partition/Offset/EventId → transport processing position
sourceAggregateSequence    → the aggregate_sequence sourceStateHash was computed AT
sourceStateHash              → authoritative MySQL state hash at sourceAggregateSequence
projectionHash                 → the document's own content hash
```

## Observability metadata is not durable identity

OTel `trace_id`/`span_id` travel alongside an event as observability metadata — they are never part of an event's durable identity, and replay must never depend on the original trace session existing.

## Graph edges are typed, never one untyped list

`CausationEdge` (causationId chain), `TimelineAncestryEdge` (parent/fork), `WorkflowEdge` (aggregate coordination) — distinct edge types in the causal graph (Phase 8).
