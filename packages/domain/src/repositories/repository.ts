import type { DomainEvent } from '../core/event.js';

/**
 * Pure Repository Interfaces — system-guarantees.md rule 2:
 * "Domain code never contains SQL or Mongo driver calls; the API never contains either.
 * Flow: API → application service → domain (loads state, decides, computes newState+events) →
 * repository interface → engine-specific repository (persists what domain already decided) → MySQL/MongoDB.
 * Neither database package ever invokes a domain reducer."
 */

export interface AggregateSnapshot<TState> {
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly sequence: number;
  readonly state: TState;
  readonly stateHash: string;
}

export interface AppendEventsResult<TState> {
  readonly success: boolean;
  readonly newSequence: number;
  readonly stateHash: string;
  readonly state: TState;
}

export interface AggregateRepository<TState, TEvent extends DomainEvent = DomainEvent> {
  load(timelineId: string, aggregateId: string): Promise<AggregateSnapshot<TState> | null>;
  save(
    timelineId: string,
    aggregateId: string,
    expectedSequence: number,
    newEvents: readonly TEvent[],
    newState: TState,
    stateHash: string,
  ): Promise<AppendEventsResult<TState>>;
}
