# ADR-004: Kafka as the durable event-distribution backbone

**Status**: Accepted (implemented Phase 4)

**Context**: The read side (MongoDB projections) needs a durable, ordered, at-least-once channel from the MySQL outbox, decoupled from MySQL's own transaction boundary.

**Decision**: Kafka (single-node KRaft, explicitly a dev/experiment topology, not a production pattern), messages keyed `timelineId:aggregateId` so ordering stays scoped per aggregate per timeline. Kafka is durable _distribution_, never the source of truth — see ADR-002.

**Consequences**: Projection rebuild (Phase 5) never depends on Kafka retention; it always replays from MySQL `events`.
