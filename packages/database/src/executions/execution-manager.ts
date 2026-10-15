import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';

export type ExecutionMode = 'LIVE_REPLAY' | 'COUNTERFACTUAL_REPLAY';
export type ExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface ExecutionRecord {
  readonly executionId: string;
  readonly mode: ExecutionMode;
  readonly timelineId: string;
  readonly aggregateId: string | null;
  readonly fromSequence: number;
  readonly toSequence: number | null;
  readonly snapshotId: string | null;
  readonly eventsReplayed: number;
  readonly stateHash: string | null;
  readonly liveStateHash: string | null;
  readonly hashParityMatched: boolean | null;
  readonly status: ExecutionStatus;
  readonly summary: Record<string, unknown> | null;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface CreateExecutionParams {
  readonly executionId: string;
  readonly mode: ExecutionMode;
  readonly timelineId: string;
  readonly aggregateId?: string | null | undefined;
  readonly fromSequence?: number | undefined;
  readonly toSequence?: number | null | undefined;
  readonly snapshotId?: string | null | undefined;
}

export interface CompleteExecutionParams {
  readonly eventsReplayed: number;
  readonly stateHash: string;
  readonly liveStateHash: string;
  readonly hashParityMatched: boolean;
  readonly summary?: Record<string, unknown> | undefined;
  readonly errorMessage?: string | null | undefined;
}

export interface IExecutionManager {
  createExecution(params: CreateExecutionParams): Promise<void>;
  completeExecution(executionId: string, params: CompleteExecutionParams): Promise<void>;
  failExecution(executionId: string, errorMessage: string): Promise<void>;
  getExecution(executionId: string): Promise<ExecutionRecord | null>;
}

interface ExecutionRow extends RowDataPacket {
  execution_id: string;
  mode: ExecutionMode;
  timeline_id: string;
  aggregate_id: string | null;
  from_sequence: number | string;
  to_sequence: number | string | null;
  snapshot_id: string | null;
  events_replayed: number | string;
  state_hash: string | null;
  live_state_hash: string | null;
  hash_parity_matched: number | boolean | null;
  status: ExecutionStatus;
  summary: unknown;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export class MysqlExecutionManager implements IExecutionManager {
  constructor(private readonly pool: Pool) {}

  public async createExecution(params: CreateExecutionParams): Promise<void> {
    await this.pool.query(SQL.INSERT_EXECUTION, [
      params.executionId,
      params.mode,
      params.timelineId,
      params.aggregateId ?? null,
      params.fromSequence ?? 0,
      params.toSequence ?? null,
      params.snapshotId ?? null,
    ]);
  }

  public async completeExecution(
    executionId: string,
    params: CompleteExecutionParams,
  ): Promise<void> {
    const summaryJson = params.summary ? JSON.stringify(params.summary) : null;
    await this.pool.query(SQL.UPDATE_EXECUTION, [
      'COMPLETED',
      params.eventsReplayed,
      params.stateHash,
      params.liveStateHash,
      params.hashParityMatched ? 1 : 0,
      summaryJson,
      params.errorMessage ?? null,
      executionId,
    ]);
  }

  public async failExecution(executionId: string, errorMessage: string): Promise<void> {
    await this.pool.query(SQL.UPDATE_EXECUTION, [
      'FAILED',
      0,
      null,
      null,
      0,
      null,
      errorMessage,
      executionId,
    ]);
  }

  public async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    const [rows] = await this.pool.query<ExecutionRow[]>(SQL.SELECT_EXECUTION_BY_ID, [executionId]);
    const r = rows[0];
    if (!r) return null;

    let parsedSummary: Record<string, unknown> | null = null;
    if (typeof r.summary === 'string') {
      try {
        parsedSummary = JSON.parse(r.summary);
      } catch {
        parsedSummary = null;
      }
    } else if (r.summary && typeof r.summary === 'object') {
      parsedSummary = r.summary as Record<string, unknown>;
    }

    return {
      executionId: r.execution_id,
      mode: r.mode,
      timelineId: r.timeline_id,
      aggregateId: r.aggregate_id,
      fromSequence: Number(r.from_sequence),
      toSequence: r.to_sequence !== null ? Number(r.to_sequence) : null,
      snapshotId: r.snapshot_id,
      eventsReplayed: Number(r.events_replayed),
      stateHash: r.state_hash,
      liveStateHash: r.live_state_hash,
      hashParityMatched:
        r.hash_parity_matched !== null
          ? Boolean(Number(r.hash_parity_matched) === 1 || r.hash_parity_matched === true)
          : null,
      status: r.status,
      summary: parsedSummary,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    };
  }
}

export class InMemoryExecutionManager implements IExecutionManager {
  private readonly executions = new Map<string, ExecutionRecord>();

  public async createExecution(params: CreateExecutionParams): Promise<void> {
    this.executions.set(params.executionId, {
      executionId: params.executionId,
      mode: params.mode,
      timelineId: params.timelineId,
      aggregateId: params.aggregateId ?? null,
      fromSequence: params.fromSequence ?? 0,
      toSequence: params.toSequence ?? null,
      snapshotId: params.snapshotId ?? null,
      eventsReplayed: 0,
      stateHash: null,
      liveStateHash: null,
      hashParityMatched: null,
      status: 'RUNNING',
      summary: null,
      errorMessage: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
  }

  public async completeExecution(
    executionId: string,
    params: CompleteExecutionParams,
  ): Promise<void> {
    const existing = this.executions.get(executionId);
    if (!existing) return;

    this.executions.set(executionId, {
      ...existing,
      status: 'COMPLETED',
      eventsReplayed: params.eventsReplayed,
      stateHash: params.stateHash,
      liveStateHash: params.liveStateHash,
      hashParityMatched: params.hashParityMatched,
      summary: params.summary ?? null,
      errorMessage: params.errorMessage ?? null,
      completedAt: new Date().toISOString(),
    });
  }

  public async failExecution(executionId: string, errorMessage: string): Promise<void> {
    const existing = this.executions.get(executionId);
    if (!existing) return;

    this.executions.set(executionId, {
      ...existing,
      status: 'FAILED',
      errorMessage,
      completedAt: new Date().toISOString(),
    });
  }

  public async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    return this.executions.get(executionId) ?? null;
  }
}
