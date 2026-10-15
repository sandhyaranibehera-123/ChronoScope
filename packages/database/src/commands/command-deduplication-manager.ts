import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';

export interface StoredCommandResult<TPayload = unknown> {
  readonly commandId: string;
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly success: boolean;
  readonly resultPayload: TPayload;
  readonly createdAt?: string;
}

export interface ICommandDeduplicationManager {
  findCommandResult(commandId: string): Promise<StoredCommandResult | null>;
  recordCommandResult(result: StoredCommandResult, connection?: PoolConnection): Promise<void>;
}

interface CommandDedupRow extends RowDataPacket {
  command_id: string;
  timeline_id: string;
  aggregate_id: string;
  success: number | boolean;
  result_payload: unknown;
  created_at: string;
}

export class MysqlCommandDeduplicationManager implements ICommandDeduplicationManager {
  constructor(private readonly pool: Pool) {}

  public async findCommandResult(commandId: string): Promise<StoredCommandResult | null> {
    const [rows] = await this.pool.query<CommandDedupRow[]>(SQL.SELECT_COMMAND_DEDUPLICATION, [
      commandId,
    ]);
    const row = rows[0];
    if (!row) return null;

    let parsedPayload = row.result_payload;
    if (typeof parsedPayload === 'string') {
      try {
        parsedPayload = JSON.parse(parsedPayload);
      } catch {
        // Keep raw string if not JSON
      }
    }

    return {
      commandId: row.command_id,
      timelineId: row.timeline_id,
      aggregateId: row.aggregate_id,
      success: Boolean(row.success),
      resultPayload: parsedPayload,
      createdAt: row.created_at,
    };
  }

  public async recordCommandResult(
    result: StoredCommandResult,
    connection?: PoolConnection,
  ): Promise<void> {
    const executor = connection ?? this.pool;
    const payloadJson = JSON.stringify(result.resultPayload);

    await executor.query(SQL.INSERT_COMMAND_DEDUPLICATION, [
      result.commandId,
      result.timelineId,
      result.aggregateId,
      result.success ? 1 : 0,
      payloadJson,
    ]);
  }
}

export class InMemoryCommandDeduplicationManager implements ICommandDeduplicationManager {
  private readonly records = new Map<string, StoredCommandResult>();

  public async findCommandResult(commandId: string): Promise<StoredCommandResult | null> {
    return this.records.get(commandId) ?? null;
  }

  public async recordCommandResult(result: StoredCommandResult): Promise<void> {
    this.records.set(result.commandId, {
      ...result,
      createdAt: result.createdAt ?? new Date().toISOString(),
    });
  }

  public clear(): void {
    this.records.clear();
  }
}
