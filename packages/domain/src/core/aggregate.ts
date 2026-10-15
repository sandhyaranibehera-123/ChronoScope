import type { DomainEvent } from './event.js';
import { computeStateHash } from './hash.js';
import { InvariantViolationError } from './errors.js';

/**
 * Base Aggregate State Representation — system-guarantees.md rule 9:
 * "aggregate_state (MySQL) is an independent, incrementally-maintained
 * materialization of current state, updated in the same MySQL transaction as the event append...
 * Three-way invariant: aggregate_versions.current_sequence == aggregate_state.aggregate_sequence
 * == MAX(events.aggregate_sequence)."
 */
export interface AggregateRecord<TState = unknown> {
  readonly timeline_id: string;
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly aggregate_sequence: number;
  readonly state: TState;
  readonly state_hash: string;
}

/**
 * Pure state reducer signature.
 * Never executes side effects or I/O.
 */
export type StateReducer<TState, TEvent extends DomainEvent = DomainEvent> = (
  currentState: TState | null,
  event: TEvent,
) => TState;

/**
 * Folds a sequence of domain events to produce the materialized state.
 * Validates contiguous sequence numbers per (timeline_id, aggregate_id).
 */
export function foldEvents<TState, TEvent extends DomainEvent = DomainEvent>(
  events: readonly TEvent[],
  reducer: StateReducer<TState, TEvent>,
  initialState: TState | null = null,
  startSequence = 0,
): AggregateRecord<TState> {
  if (events.length === 0) {
    if (!initialState) {
      throw new InvariantViolationError('Cannot fold empty event stream without initial state');
    }
    return {
      timeline_id: '',
      aggregate_id: '',
      aggregate_type: '',
      aggregate_sequence: startSequence,
      state: initialState,
      state_hash: computeStateHash(initialState),
    };
  }

  const first = events[0];
  if (!first) {
    throw new InvariantViolationError('Cannot fold empty event stream');
  }

  let currentState: TState | null = initialState;
  let expectedSeq = startSequence === 0 ? first.aggregate_sequence : startSequence + 1;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;

    if (event.timeline_id !== first.timeline_id || event.aggregate_id !== first.aggregate_id) {
      throw new InvariantViolationError(
        `Cross-aggregate events in fold: expected ${first.timeline_id}:${first.aggregate_id}, found ${event.timeline_id}:${event.aggregate_id}`,
      );
    }

    if (event.aggregate_sequence !== expectedSeq) {
      throw new InvariantViolationError(
        `Sequence gap or out-of-order in event stream: expected ${expectedSeq}, got ${event.aggregate_sequence}`,
      );
    }

    currentState = reducer(currentState, event);
    expectedSeq++;
  }

  const lastEvent = events[events.length - 1];
  if (!lastEvent || !currentState) {
    throw new InvariantViolationError('Folding produced null state or missing last event');
  }

  return {
    timeline_id: lastEvent.timeline_id,
    aggregate_id: lastEvent.aggregate_id,
    aggregate_type: lastEvent.aggregate_type,
    aggregate_sequence: lastEvent.aggregate_sequence,
    state: currentState,
    state_hash: computeStateHash(currentState),
  };
}

/**
 * Validates the three-way invariant (Rule 9).
 */
export function assertThreeWayInvariant(
  versionSequence: number,
  stateSequence: number,
  maxEventSequence: number,
): void {
  if (versionSequence !== stateSequence || stateSequence !== maxEventSequence) {
    throw new InvariantViolationError(
      `Three-way invariant violated: aggregate_versions (${versionSequence}) == ` +
        `aggregate_state (${stateSequence}) == MAX(events) (${maxEventSequence})`,
    );
  }
}
