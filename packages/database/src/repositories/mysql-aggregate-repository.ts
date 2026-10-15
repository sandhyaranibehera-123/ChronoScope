import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  AggregateRepository,
  AggregateSnapshot,
  AppendEventsResult,
  DomainEvent,
} from '@chronoscope/domain';
import { executeAppendTransaction } from '../event-store/append-transaction.js';
import { SQL } from '../sql/statements.js';
import { withTransaction } from '../transaction.js';

interface AggregateStateRow extends RowDataPacket {
  timeline_id: string;
  aggregate_id: string;
  aggregate_type: string;
  aggregate_sequence: number | string;
  state: string | Record<string, unknown>;
  state_hash: string;
  updated_at: string;
}

export class MySqlAggregateRepository<
  TState,
  TEvent extends DomainEvent = DomainEvent,
> implements AggregateRepository<TState, TEvent> {
  constructor(
    private readonly pool: Pool,
    private readonly aggregateType: string,
    private readonly outboxTopic: string = 'chronoscope.domain.events',
  ) {}

  public async load(
    timelineId: string,
    aggregateId: string,
  ): Promise<AggregateSnapshot<TState> | null> {
    const [rows] = await this.pool.query<AggregateStateRow[]>(SQL.SELECT_AGGREGATE_STATE, [
      timelineId,
      aggregateId,
    ]);

    const firstRow = rows[0];
    if (!firstRow) {
      return null;
    }

    const state = (
      typeof firstRow.state === 'string' ? JSON.parse(firstRow.state) : firstRow.state
    ) as TState;

    return {
      timelineId: firstRow.timeline_id,
      aggregateId: firstRow.aggregate_id,
      aggregateType: firstRow.aggregate_type,
      sequence: Number(firstRow.aggregate_sequence),
      state,
      stateHash: firstRow.state_hash,
    };
  }

  public async save(
    timelineId: string,
    aggregateId: string,
    expectedSequence: number,
    newEvents: readonly TEvent[],
    newState: TState,
    stateHash: string,
  ): Promise<AppendEventsResult<TState>> {
    return withTransaction(this.pool, async (connection) => {
      return executeAppendTransaction(connection, {
        timelineId,
        aggregateId,
        aggregateType: this.aggregateType,
        expectedSequence,
        newEvents,
        newState,
        stateHash,
        outboxTopic: this.outboxTopic,
      });
    });
  }
}
