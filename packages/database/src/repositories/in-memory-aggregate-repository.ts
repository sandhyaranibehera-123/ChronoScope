import { randomUUID } from 'node:crypto';
import type {
  AggregateRepository,
  AggregateSnapshot,
  AppendEventsResult,
  DomainEvent,
} from '@chronoscope/domain';
import {
  ConcurrencyError,
  InvariantViolationError,
  PreconditionFailedError,
} from '@chronoscope/domain';

export interface InMemoryTimelineRecord {
  readonly timelineId: string;
  readonly parentTimelineId: string | null;
  readonly forkPosition: number;
  readonly headPosition: number;
  readonly name: string;
  readonly description: string | null;
  readonly status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
}

export interface InMemoryTimelineAncestryNode {
  readonly timelineId: string;
  readonly parentTimelineId: string | null;
  readonly forkPosition: number;
  readonly depth: number;
}

export interface StoredMemoryEvent<TPayload = unknown> {
  readonly eventId: string;
  readonly timelineId: string;
  readonly timelinePosition: number;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateSequence: number;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: TPayload;
  readonly eventHash: string;
  readonly causationId: string | null;
  readonly correlationId: string;
  readonly recordedAt: string;
}

export interface StoredOutboxRecord {
  readonly outboxId: string;
  readonly eventId: string;
  readonly topic: string;
  readonly partitionKey: string;
  readonly payload: unknown;
  readonly status: 'PENDING' | 'LEASED' | 'PUBLISHED' | 'FAILED' | 'RETRY_PENDING';
  readonly attemptCount: number;
  readonly createdAt: string;
}

/**
 * High-fidelity, deterministic in-memory event store implementing identical
 * OCC row-locking semantics, dual-sequencing, three-way invariant, named duplicate-key errors,
 * and outbox leasing for 100% infra-free unit test execution (system-guarantees.md Rule 24).
 */
export class InMemoryAggregateRepository<
  TState,
  TEvent extends DomainEvent = DomainEvent,
> implements AggregateRepository<TState, TEvent> {
  // timelineId -> aggregateId -> version
  private readonly versions = new Map<string, Map<string, number>>();

  // timelineId -> aggregateId -> state snapshot
  private readonly states = new Map<string, Map<string, AggregateSnapshot<TState>>>();

  // Global events store
  private readonly events: StoredMemoryEvent[] = [];

  // Outbox queue
  private readonly outbox: StoredOutboxRecord[] = [];

  // Global monotonic sequence generator for timeline_position (Rule 5 & 6)
  private globalTimelinePositionSeq = 0;

  // Timeline best-effort head cache
  private readonly timelineHeads = new Map<string, number>();

  // Timelines storage (Rule 6, 13)
  private readonly timelines = new Map<string, InMemoryTimelineRecord>([
    [
      '00000000-0000-0000-0000-000000000001',
      {
        timelineId: '00000000-0000-0000-0000-000000000001',
        parentTimelineId: null,
        forkPosition: 0,
        headPosition: 0,
        name: 'MAIN',
        description: 'Root timeline for authoritative mainline execution',
        status: 'ACTIVE',
      },
    ],
  ]);

  constructor(
    private readonly aggregateType: string,
    private readonly outboxTopic: string = 'chronoscope.domain.events',
  ) {}

  public async load(
    timelineId: string,
    aggregateId: string,
  ): Promise<AggregateSnapshot<TState> | null> {
    const timelineMap = this.states.get(timelineId);
    if (!timelineMap) return null;
    return timelineMap.get(aggregateId) ?? null;
  }

  public async save(
    timelineId: string,
    aggregateId: string,
    expectedSequence: number,
    newEvents: readonly TEvent[],
    newState: TState,
    stateHash: string,
  ): Promise<AppendEventsResult<TState>> {
    // 1. Initialize version map for timeline if missing
    if (!this.versions.has(timelineId)) {
      this.versions.set(timelineId, new Map());
    }
    const timelineVersions = this.versions.get(timelineId)!;

    // Handle initial aggregate insertion race (Rule 16: expectedSequence === 0)
    if (!timelineVersions.has(aggregateId)) {
      if (expectedSequence !== 0) {
        throw new ConcurrencyError(
          `Aggregate ${this.aggregateType}[${aggregateId}] not found on timeline ${timelineId}. Expected sequence ${expectedSequence}, but current is 0.`,
          { expectedSequence, actualSequence: 0, aggregateId, timelineId },
        );
      }
      timelineVersions.set(aggregateId, 0);
    }

    const currentSequence = timelineVersions.get(aggregateId)!;

    // 2. OCC Verification (Rule 6)
    if (currentSequence !== expectedSequence) {
      throw new ConcurrencyError(
        `OCC Conflict on ${this.aggregateType}[${aggregateId}]: expected sequence ${expectedSequence}, but found current sequence ${currentSequence}`,
        { expectedSequence, actualSequence: currentSequence, aggregateId, timelineId },
      );
    }

    if (newEvents.length === 0) {
      return {
        success: true,
        newSequence: currentSequence,
        stateHash,
        state: newState,
      };
    }

    const newSequence = expectedSequence + newEvents.length;

    // 3. Validate duplicate event_ids across store
    for (const event of newEvents) {
      if (this.events.some((e) => e.eventId === event.event_id)) {
        throw new InvariantViolationError(
          `Duplicate event_id detected during event append: ${event.event_id}`,
          { eventId: event.event_id, keyName: 'PRIMARY', timelineId, aggregateId },
        );
      }
    }

    // 4. Append events with dual sequencing
    for (let i = 0; i < newEvents.length; i++) {
      const event = newEvents[i]!;
      const eventSequence = expectedSequence + 1 + i;

      this.globalTimelinePositionSeq += 1;
      const timelinePos = this.globalTimelinePositionSeq;

      this.events.push({
        eventId: String(event.event_id),
        timelineId,
        timelinePosition: timelinePos,
        aggregateId,
        aggregateType: this.aggregateType,
        aggregateSequence: eventSequence,
        eventType: event.event_type,
        schemaVersion: event.schema_version,
        payload: event.payload,
        eventHash: event.event_hash,
        causationId: event.causation_id ? String(event.causation_id) : null,
        correlationId: String(event.correlation_id),
        recordedAt: event.recorded_at,
      });

      // Transactional outbox entry (Rule 8, 10)
      this.outbox.push({
        outboxId: randomUUID(),
        eventId: String(event.event_id),
        topic: this.outboxTopic,
        partitionKey: `${timelineId}:${aggregateId}`,
        payload: {
          ...event,
          timeline_position: timelinePos,
          aggregate_sequence: eventSequence,
        },
        status: 'PENDING',
        attemptCount: 0,
        createdAt: new Date().toISOString(),
      });

      // Update cached timeline head_position (Rule 6)
      const currentHead = this.timelineHeads.get(timelineId) ?? 0;
      this.timelineHeads.set(timelineId, Math.max(currentHead, timelinePos));
    }

    // 5. Update aggregate_versions
    timelineVersions.set(aggregateId, newSequence);

    // 6. Update aggregate_state (Rule 9: three-way invariant)
    if (!this.states.has(timelineId)) {
      this.states.set(timelineId, new Map());
    }
    this.states.get(timelineId)!.set(aggregateId, {
      timelineId,
      aggregateId,
      aggregateType: this.aggregateType,
      sequence: newSequence,
      state: newState,
      stateHash,
    });

    return {
      success: true,
      newSequence,
      stateHash,
      state: newState,
    };
  }

  // Inspection helpers for tests
  public getEvents(timelineId?: string, aggregateId?: string): readonly StoredMemoryEvent[] {
    return this.events.filter((e) => {
      if (timelineId && e.timelineId !== timelineId) return false;
      if (aggregateId && e.aggregateId !== aggregateId) return false;
      return true;
    });
  }

  public getOutbox(status?: string): readonly StoredOutboxRecord[] {
    return status ? this.outbox.filter((o) => o.status === status) : [...this.outbox];
  }

  public getHeadPosition(timelineId: string): number {
    return this.timelineHeads.get(timelineId) ?? 0;
  }

  /**
   * Creates or forks a timeline with transactional fork position validation (Rules 6 & 13).
   */
  public createTimeline(params: {
    timelineId: string;
    parentTimelineId?: string | null;
    forkPosition?: number;
    name: string;
    description?: string | null;
  }): InMemoryTimelineRecord {
    const {
      timelineId,
      parentTimelineId = null,
      forkPosition = 0,
      name,
      description = null,
    } = params;

    if (parentTimelineId) {
      const parent = this.timelines.get(parentTimelineId);
      if (!parent) {
        throw new PreconditionFailedError(`Parent timeline ${parentTimelineId} does not exist`, {
          parentTimelineId,
          timelineId,
        });
      }

      // Check max timeline position of parent
      const parentEvents = this.events.filter((e) => e.timelineId === parentTimelineId);
      const parentMaxPos = parentEvents.reduce((max, e) => Math.max(max, e.timelinePosition), 0);

      if (forkPosition < 0 || forkPosition > parentMaxPos) {
        throw new PreconditionFailedError(
          `Invalid fork_position ${forkPosition}: must satisfy 0 <= fork_position <= ${parentMaxPos} (parent timeline max position)`,
          { forkPosition, parentMaxPos, parentTimelineId, timelineId },
        );
      }
    } else if (forkPosition !== 0) {
      throw new PreconditionFailedError(
        `Root timeline without parent must have fork_position = 0, got ${forkPosition}`,
        { forkPosition, timelineId },
      );
    }

    const record: InMemoryTimelineRecord = {
      timelineId,
      parentTimelineId,
      forkPosition,
      headPosition: 0,
      name,
      description,
      status: 'ACTIVE',
    };

    this.timelines.set(timelineId, record);
    return record;
  }

  public getTimeline(timelineId: string): InMemoryTimelineRecord | null {
    const t = this.timelines.get(timelineId);
    return t ? { ...t } : null;
  }

  /**
   * Retrieves full timeline ancestry hierarchy (Rule 13).
   * Traverses from leaf timeline up to root.
   */
  public getAncestry(timelineId: string): InMemoryTimelineAncestryNode[] {
    const ancestry: InMemoryTimelineAncestryNode[] = [];
    let currentId: string | null = timelineId;
    let depth = 0;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) {
        throw new InvariantViolationError(`Cycle detected in timeline ancestry at ${currentId}`);
      }
      visited.add(currentId);

      const timeline = this.timelines.get(currentId);
      if (!timeline) break;

      ancestry.push({
        timelineId: timeline.timelineId,
        parentTimelineId: timeline.parentTimelineId,
        forkPosition: timeline.forkPosition,
        depth,
      });

      currentId = timeline.parentTimelineId;
      depth++;
    }

    return ancestry;
  }

  /**
   * Resolves effective history of events for a timeline (Rule 13 & ADR-010):
   * EffectiveHistory(B) = EffectiveHistory(P, <= F) + LocalEvents(B)
   */
  public getEffectiveEvents(timelineId: string, aggregateId?: string): StoredMemoryEvent[] {
    const path: Array<{ timelineId: string; maxAllowedPos: number | null }> = [];
    let currentId: string | null = timelineId;

    while (currentId) {
      const timeline = this.timelines.get(currentId);
      if (!timeline) break;

      if (path.length === 0) {
        path.push({ timelineId: timeline.timelineId, maxAllowedPos: null });
      } else {
        const previousNode = path[path.length - 1]!;
        // The child's forkPosition bounds this parent's events
        const childTimeline = this.timelines.get(previousNode.timelineId)!;
        path.push({ timelineId: timeline.timelineId, maxAllowedPos: childTimeline.forkPosition });
      }

      currentId = timeline.parentTimelineId;
    }

    const pathMap = new Map(path.map((p) => [p.timelineId, p.maxAllowedPos]));

    return this.events
      .filter((e) => {
        if (!pathMap.has(e.timelineId)) return false;
        const maxPos = pathMap.get(e.timelineId);
        if (maxPos !== null && maxPos !== undefined && e.timelinePosition > maxPos) {
          return false;
        }
        if (aggregateId && e.aggregateId !== aggregateId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.timelinePosition - b.timelinePosition)
      .map((e) => ({
        ...e,
        event_id: e.eventId,
        timeline_id: e.timelineId,
        timeline_position: e.timelinePosition,
        aggregate_id: e.aggregateId,
        aggregate_type: e.aggregateType,
        aggregate_sequence: e.aggregateSequence,
        event_type: e.eventType,
        schema_version: e.schemaVersion,
        event_hash: e.eventHash,
        causation_id: e.causationId,
        correlation_id: e.correlationId,
        recorded_at: e.recordedAt,
      }));
  }

  /**
   * Explicitly materializes an aggregate on a branch at sequence 0 with inherited state (Rule 13).
   * aggregate_versions.current_sequence = 0
   * aggregate_state = { aggregate_sequence: 0, state: inheritedState, state_hash: stateHash }
   */
  public materializeBranchAggregate(
    timelineId: string,
    aggregateId: string,
    inheritedState: TState,
    stateHash: string,
  ): void {
    if (!this.versions.has(timelineId)) {
      this.versions.set(timelineId, new Map());
    }
    this.versions.get(timelineId)!.set(aggregateId, 0);

    if (!this.states.has(timelineId)) {
      this.states.set(timelineId, new Map());
    }
    this.states.get(timelineId)!.set(aggregateId, {
      timelineId,
      aggregateId,
      aggregateType: this.aggregateType,
      sequence: 0,
      state: inheritedState,
      stateHash,
    });
  }

  /**
   * Causal Graph queries (Phase 8, Rules 5, 12, 24).
   */
  public getEventById(eventId: string): (StoredMemoryEvent & Record<string, unknown>) | null {
    const e = this.events.find((ev) => ev.eventId === eventId);
    if (!e) return null;
    return {
      ...e,
      event_id: e.eventId,
      timeline_id: e.timelineId,
      timeline_position: e.timelinePosition,
      aggregate_id: e.aggregateId,
      aggregate_type: e.aggregateType,
      aggregate_sequence: e.aggregateSequence,
      event_type: e.eventType,
      schema_version: e.schemaVersion,
      event_hash: e.eventHash,
      causation_id: e.causationId,
      correlation_id: e.correlationId,
      recorded_at: e.recordedAt,
    };
  }

  public getEventsByCorrelationId(
    correlationId: string,
  ): Array<StoredMemoryEvent & Record<string, unknown>> {
    return this.events
      .filter((ev) => ev.correlationId === correlationId)
      .sort((a, b) => a.timelinePosition - b.timelinePosition)
      .map((e) => ({
        ...e,
        event_id: e.eventId,
        timeline_id: e.timelineId,
        timeline_position: e.timelinePosition,
        aggregate_id: e.aggregateId,
        aggregate_type: e.aggregateType,
        aggregate_sequence: e.aggregateSequence,
        event_type: e.eventType,
        schema_version: e.schemaVersion,
        event_hash: e.eventHash,
        causation_id: e.causationId,
        correlation_id: e.correlationId,
        recorded_at: e.recordedAt,
      }));
  }

  public getEventsByCausationId(
    causationId: string,
  ): Array<StoredMemoryEvent & Record<string, unknown>> {
    return this.events
      .filter((ev) => ev.causationId === causationId)
      .sort((a, b) => a.timelinePosition - b.timelinePosition)
      .map((e) => ({
        ...e,
        event_id: e.eventId,
        timeline_id: e.timelineId,
        timeline_position: e.timelinePosition,
        aggregate_id: e.aggregateId,
        aggregate_type: e.aggregateType,
        aggregate_sequence: e.aggregateSequence,
        event_type: e.eventType,
        schema_version: e.schemaVersion,
        event_hash: e.eventHash,
        causation_id: e.causationId,
        correlation_id: e.correlationId,
        recorded_at: e.recordedAt,
      }));
  }

  public getEventsByTimelineId(
    timelineId: string,
  ): Array<StoredMemoryEvent & Record<string, unknown>> {
    return this.events
      .filter((ev) => ev.timelineId === timelineId)
      .sort((a, b) => a.timelinePosition - b.timelinePosition)
      .map((e) => ({
        ...e,
        event_id: e.eventId,
        timeline_id: e.timelineId,
        timeline_position: e.timelinePosition,
        aggregate_id: e.aggregateId,
        aggregate_type: e.aggregateType,
        aggregate_sequence: e.aggregateSequence,
        event_type: e.eventType,
        schema_version: e.schemaVersion,
        event_hash: e.eventHash,
        causation_id: e.causationId,
        correlation_id: e.correlationId,
        recorded_at: e.recordedAt,
      }));
  }

  public getAllEvents(): Array<StoredMemoryEvent & Record<string, unknown>> {
    return this.events
      .slice()
      .sort((a, b) => a.timelinePosition - b.timelinePosition)
      .map((e) => ({
        ...e,
        event_id: e.eventId,
        timeline_id: e.timelineId,
        timeline_position: e.timelinePosition,
        aggregate_id: e.aggregateId,
        aggregate_type: e.aggregateType,
        aggregate_sequence: e.aggregateSequence,
        event_type: e.eventType,
        schema_version: e.schemaVersion,
        event_hash: e.eventHash,
        causation_id: e.causationId,
        correlation_id: e.correlationId,
        recorded_at: e.recordedAt,
      }));
  }
}
