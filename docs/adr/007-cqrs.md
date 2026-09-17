# ADR-007: CQRS — MySQL write model, MongoDB read model

**Status**: Accepted

**Context**: The write path needs strict OCC/transactional guarantees; the read path needs fast, denormalized, per-query-shape documents. Forcing both through one model serves neither well.

**Decision**: Commands write MySQL (events + `aggregate_state` + outbox); queries read only MongoDB `chronoscope_read`, never raw event history or MySQL directly. See ADR-016 for the full polyglot-persistence rationale.

**Consequences**: Eventual consistency and projection lag are intentional and become subjects the project explicitly measures (Phase 13), not defects to hide.
