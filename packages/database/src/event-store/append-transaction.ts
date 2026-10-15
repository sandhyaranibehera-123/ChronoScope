import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { AppendEventsResult, DomainEvent } from '@chronoscope/domain';
import { ConcurrencyError, InvariantViolationError } from '@chronoscope/domain';
import { extractDuplicateKeyName, isDuplicateEntryError } from '../errors.js';
import { SQL } from '../sql/statements.js';

export interface AppendTransactionParams<TState, TEvent extends DomainEvent = DomainEvent> {
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly expectedSequence: number;
  readonly newEvents: readonly TEvent[];
  readonly newState: TState;
  readonly stateHash: string;
  readonly outboxTopic?: string;
}

/**
 * Atomic Event Append Transaction — system-guarantees.md rules 3, 5, 6, 8, 9, 16.
 *
 * Execution Steps:
 * 1. If expectedSequence === 0: handle aggregate creation race via INSERT IGNORE (Rule 16).
 * 2. Lock ONLY the aggregate_versions row (SELECT ... FOR UPDATE) (Rule 6). Never locks timeline-wide.
 * 3. Verify current_sequence === expectedSequence. On mismatch, abort with OCC ConcurrencyError.
 * 4. For each event:
 *    - Allocate logical timeline_position from timeline_position_seq (Rule 5 & 6).
 *    - Derive contiguous aggregate_sequence = expectedSequence + 1 + i.
 *    - Insert into chronoscope_core.events. Disambiguate duplicate keys via named UNIQUE KEYs.
 *    - Insert into chronoscope_core.outbox for reliable Kafka propagation (Rule 8 & 10).
 * 5. Update chronoscope_core.aggregate_versions.current_sequence = newSequence.
 * 6. Upsert chronoscope_core.aggregate_state (Rule 9: three-way invariant).
 * 7. Update chronoscope_core.timelines.head_position cache via GREATEST() (Rule 6).
 */
interface AggregateVersionRow extends RowDataPacket {
  current_sequence: number | string;
}

export async function executeAppendTransaction<TState, TEvent extends DomainEvent = DomainEvent>(
  connection: PoolConnection,
  params: AppendTransactionParams<TState, TEvent>,
): Promise<AppendEventsResult<TState>> {
  const {
    timelineId,
    aggregateId,
    aggregateType,
    expectedSequence,
    newEvents,
    newState,
    stateHash,
    outboxTopic = 'chronoscope.domain.events',
  } = params;

  // Step 1: Aggregate creation race handling for expectedSequence === 0 (Rule 16)
  if (expectedSequence === 0) {
    await connection.query(SQL.INSERT_IGNORE_AGGREGATE_VERSION, [
      timelineId,
      aggregateId,
      aggregateType,
    ]);
  }

  // Step 2: Row-level lock on aggregate_versions ONLY (Rule 6)
  const [rows] = await connection.query<AggregateVersionRow[]>(SQL.LOCK_AGGREGATE_VERSION, [
    timelineId,
    aggregateId,
  ]);

  const firstRow = rows[0];
  if (!firstRow) {
    throw new ConcurrencyError(
      `Aggregate ${aggregateType}[${aggregateId}] on timeline ${timelineId} not found. Expected sequence ${expectedSequence}, but aggregate does not exist.`,
      { expectedSequence, actualSequence: -1, aggregateId, timelineId },
    );
  }

  const currentSequence = Number(firstRow.current_sequence);

  // Step 3: Optimistic Concurrency Control (OCC) check
  if (currentSequence !== expectedSequence) {
    throw new ConcurrencyError(
      `OCC Conflict on ${aggregateType}[${aggregateId}]: expected sequence ${expectedSequence}, but found current sequence ${currentSequence}`,
      { expectedSequence, actualSequence: currentSequence, aggregateId, timelineId },
    );
  }

  // If command produced 0 events, state remains unchanged
  if (newEvents.length === 0) {
    return {
      success: true,
      newSequence: currentSequence,
      stateHash,
      state: newState,
    };
  }

  const newSequence = expectedSequence + newEvents.length;
  let maxAllocatedTimelinePosition = 0;

  try {
    // Step 4: Append each event with dual sequencing
    for (let i = 0; i < newEvents.length; i++) {
      const event = newEvents[i]!;
      const eventSequence = expectedSequence + 1 + i;

      // Allocate timeline_position from sequence generator table (Rule 5 & 6)
      const [seqResult] = await connection.query<ResultSetHeader>(SQL.ALLOCATE_TIMELINE_POSITION);
      const timelinePosition = Number(seqResult.insertId);
      if (timelinePosition > maxAllocatedTimelinePosition) {
        maxAllocatedTimelinePosition = timelinePosition;
      }

      // Insert event into chronoscope_core.events
      await connection.query(SQL.INSERT_EVENT, [
        event.event_id,
        timelineId,
        timelinePosition,
        aggregateId,
        aggregateType,
        eventSequence,
        event.event_type,
        event.schema_version,
        JSON.stringify(event.payload),
        event.event_hash,
        event.causation_id ?? null,
        event.correlation_id,
        (event as { command_id?: string }).command_id ?? null,
        event.recorded_at,
      ]);

      // Enqueue to outbox in same transaction (Rule 8, 10)
      const outboxId = randomUUID();
      const partitionKey = `${timelineId}:${aggregateId}`;
      const outboxPayload = JSON.stringify({
        ...event,
        timeline_position: timelinePosition,
        aggregate_sequence: eventSequence,
      });

      await connection.query(SQL.INSERT_OUTBOX, [
        outboxId,
        event.event_id,
        outboxTopic,
        partitionKey,
        outboxPayload,
        JSON.stringify({
          eventType: event.event_type,
          aggregateType,
          schemaVersion: event.schema_version,
        }),
      ]);
    }

    // Step 5: Advance aggregate_versions.current_sequence
    await connection.query(SQL.UPDATE_AGGREGATE_VERSION, [newSequence, timelineId, aggregateId]);

    // Step 6: Upsert aggregate_state (Rule 9: three-way invariant)
    await connection.query(SQL.UPSERT_AGGREGATE_STATE, [
      timelineId,
      aggregateId,
      aggregateType,
      newSequence,
      JSON.stringify(newState),
      stateHash,
    ]);

    // Step 7: Update cached timeline head_position (Rule 6)
    if (maxAllocatedTimelinePosition > 0) {
      await connection.query(SQL.UPDATE_TIMELINE_HEAD, [maxAllocatedTimelinePosition, timelineId]);
    }
  } catch (error) {
    if (isDuplicateEntryError(error)) {
      const keyName = extractDuplicateKeyName(error);

      if (keyName?.includes('PRIMARY') || keyName?.includes('PRIMARY_KEY')) {
        throw new InvariantViolationError(
          `Duplicate event_id detected during event append: ${error.message}`,
          { keyName, timelineId, aggregateId },
        );
      }

      if (keyName?.includes('uq_events_aggregate_sequence')) {
        throw new ConcurrencyError(
          `OCC Conflict: aggregate_sequence duplicate entry on key uq_events_aggregate_sequence: ${error.message}`,
          { keyName, expectedSequence, aggregateId, timelineId },
        );
      }

      if (keyName?.includes('uq_events_timeline_position')) {
        throw new InvariantViolationError(
          `Timeline position conflict on key uq_events_timeline_position: ${error.message}`,
          { keyName, timelineId, aggregateId },
        );
      }
    }

    throw error;
  }

  return {
    success: true,
    newSequence,
    stateHash,
    state: newState,
  };
}
