import type { Pool, RowDataPacket } from 'mysql2/promise';
import {
  type DomainEvent,
  type AggregateRecord,
  foldEvents,
  computeStateHash,
  orderReducer,
  paymentReducer,
  inventoryReducer,
  shipmentReducer,
  type StateReducer,
} from '@chronoscope/domain';

export interface ResolvedAuthoritativeState<TState = unknown> {
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateSequence: number;
  readonly state: TState | null;
  readonly stateHash: string;
}

export interface IEventReader {
  loadEventsForAggregate(
    timelineId: string,
    aggregateId: string,
    maxSequence?: number,
  ): Promise<readonly DomainEvent[]>;
}

interface EventRow extends RowDataPacket {
  event_id: string;
  timeline_id: string;
  timeline_position: number | string;
  aggregate_id: string;
  aggregate_type: string;
  aggregate_sequence: number | string;
  event_type: string;
  schema_version: number;
  payload: unknown;
  event_hash: string;
  causation_id: string | null;
  correlation_id: string;
  command_id: string | null;
  recorded_at: string;
}

export class MysqlEventReader implements IEventReader {
  constructor(private readonly pool: Pool) {}

  public async loadEventsForAggregate(
    timelineId: string,
    aggregateId: string,
    maxSequence?: number,
  ): Promise<readonly DomainEvent[]> {
    let query = `
      SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
             aggregate_sequence, event_type, schema_version, payload, event_hash,
             causation_id, correlation_id, command_id, recorded_at
      FROM chronoscope_core.events
      WHERE timeline_id = ? AND aggregate_id = ?
    `;
    const params: (string | number)[] = [timelineId, aggregateId];

    if (maxSequence !== undefined) {
      query += ` AND aggregate_sequence <= ?`;
      params.push(maxSequence);
    }

    query += ` ORDER BY aggregate_sequence ASC`;

    const [rows] = await this.pool.query<EventRow[]>(query, params);

    return rows.map((r) => {
      let payload = r.payload;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          // keep as string
        }
      }

      return {
        event_id: r.event_id,
        timeline_id: r.timeline_id,
        timeline_position: Number(r.timeline_position),
        aggregate_id: r.aggregate_id,
        aggregate_type: r.aggregate_type,
        aggregate_sequence: Number(r.aggregate_sequence),
        event_type: r.event_type,
        schema_version: r.schema_version,
        payload,
        event_hash: r.event_hash,
        causation_id: r.causation_id,
        correlation_id: r.correlation_id,
        command_id: r.command_id,
        recorded_at: r.recorded_at,
      } as unknown as DomainEvent;
    });
  }
}

export class InMemoryEventReader implements IEventReader {
  private readonly events: DomainEvent[] = [];

  constructor(initialEvents: readonly DomainEvent[] = []) {
    this.events = [...initialEvents];
  }

  public addEvents(events: readonly DomainEvent[]): void {
    this.events.push(...events);
  }

  public async loadEventsForAggregate(
    timelineId: string,
    aggregateId: string,
    maxSequence?: number,
  ): Promise<readonly DomainEvent[]> {
    return this.events
      .filter((e) => {
        if (e.timeline_id !== timelineId || e.aggregate_id !== aggregateId) {
          return false;
        }
        if (maxSequence !== undefined && e.aggregate_sequence > maxSequence) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.aggregate_sequence - b.aggregate_sequence);
  }
}

/**
 * AuthoritativeStateResolver — system-guarantees.md Rule 11 & Phase 5:
 *
 * "the historical state (and per-document sourceStateHash/sourceAggregateSequence/projectionHash)
 * for every aggregate is computed by a dedicated AuthoritativeStateResolver (packages/replay-engine...
 * never the Mongo repository, consistent with rule 2's 'database packages never invoke a domain reducer')
 * — resolve(timelineId, aggregateId, targetSequence) -> {state, stateHash}, implemented as
 * EffectiveHistory(timeline, <= targetSequence) folded through the domain reducer, the same
 * abstraction the live projection worker's lagging-sourceStateHash check calls too, so there is
 * exactly one implementation of 'historical authoritative state at sequence N,' not two that could drift apart"
 */
export class AuthoritativeStateResolver {
  private readonly reducers = new Map<string, StateReducer<never, never>>();

  constructor(private readonly eventReader: IEventReader) {
    // Register built-in domain reducers
    this.registerReducer('Order', orderReducer as unknown as StateReducer<never, never>);
    this.registerReducer('ORDER', orderReducer as unknown as StateReducer<never, never>);
    this.registerReducer('Payment', paymentReducer as unknown as StateReducer<never, never>);
    this.registerReducer('PAYMENT', paymentReducer as unknown as StateReducer<never, never>);
    this.registerReducer('Inventory', inventoryReducer as unknown as StateReducer<never, never>);
    this.registerReducer('INVENTORY', inventoryReducer as unknown as StateReducer<never, never>);
    this.registerReducer('Shipment', shipmentReducer as unknown as StateReducer<never, never>);
    this.registerReducer('SHIPMENT', shipmentReducer as unknown as StateReducer<never, never>);
  }

  public registerReducer<TState, TEvent extends DomainEvent>(
    aggregateType: string,
    reducer: StateReducer<TState, TEvent>,
  ): void {
    this.reducers.set(aggregateType, reducer as unknown as StateReducer<never, never>);
  }

  public async resolve<TState = unknown>(
    timelineId: string,
    aggregateId: string,
    targetSequence: number,
    aggregateType = 'Order',
  ): Promise<ResolvedAuthoritativeState<TState>> {
    if (targetSequence === 0) {
      return {
        timelineId,
        aggregateId,
        aggregateType,
        aggregateSequence: 0,
        state: null,
        stateHash: computeStateHash(null),
      };
    }

    const events = await this.eventReader.loadEventsForAggregate(
      timelineId,
      aggregateId,
      targetSequence,
    );

    if (events.length === 0) {
      return {
        timelineId,
        aggregateId,
        aggregateType,
        aggregateSequence: 0,
        state: null,
        stateHash: computeStateHash(null),
      };
    }

    const reducer = this.reducers.get(aggregateType);
    if (!reducer) {
      throw new Error(`No registered state reducer for aggregate type '${aggregateType}'`);
    }

    const record: AggregateRecord<TState> = foldEvents(events as never, reducer as never);

    return {
      timelineId: record.timeline_id || timelineId,
      aggregateId: record.aggregate_id || aggregateId,
      aggregateType: record.aggregate_type || aggregateType,
      aggregateSequence: record.aggregate_sequence,
      state: record.state,
      stateHash: record.state_hash,
    };
  }
}
