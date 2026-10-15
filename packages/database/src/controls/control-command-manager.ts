import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { NotFoundError, PreconditionFailedError } from '@chronoscope/domain';
import { SQL } from '../sql/statements.js';
import type {
  IControlCommandManager,
  ControlCommandRecord,
  CreateControlCommandOptions,
  ControlCommandStatus,
} from './types.js';

interface ControlCommandRow extends RowDataPacket {
  command_id: string;
  command_type: string;
  target_worker: string;
  payload: string | Record<string, unknown>;
  status: ControlCommandStatus;
  issued_by: string;
  result_payload: string | Record<string, unknown> | null;
  error_message: string | null;
  attempt_count: number | string;
  acknowledged_by: string | null;
  acknowledged_at: string | Date | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapControlCommandRow(row: ControlCommandRow): ControlCommandRecord {
  const payload =
    typeof row.payload === 'string'
      ? JSON.parse(row.payload)
      : (row.payload as Record<string, unknown>);

  const resultPayload =
    row.result_payload === null
      ? null
      : typeof row.result_payload === 'string'
        ? JSON.parse(row.result_payload)
        : (row.result_payload as Record<string, unknown>);

  return {
    commandId: row.command_id,
    commandType: row.command_type,
    targetWorker: row.target_worker,
    payload,
    status: row.status,
    issuedBy: row.issued_by,
    resultPayload,
    errorMessage: row.error_message,
    attemptCount: Number(row.attempt_count),
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class MysqlControlCommandManager implements IControlCommandManager {
  constructor(private readonly pool: Pool) {}

  public async issueCommand(
    options: CreateControlCommandOptions,
  ): Promise<{ command: ControlCommandRecord; isNew: boolean }> {
    const commandId = options.commandId ?? randomUUID();

    // 1. Idempotency check by command_id (Rule 18)
    const existing = await this.getCommandById(commandId);
    if (existing) {
      return { command: existing, isNew: false };
    }

    const payloadJson = JSON.stringify(options.payload);
    const issuedBy = options.issuedBy ?? 'operator';

    await this.pool.query<ResultSetHeader>(SQL.INSERT_CONTROL_COMMAND, [
      commandId,
      options.commandType,
      options.targetWorker,
      payloadJson,
      issuedBy,
    ]);

    const created = await this.getCommandById(commandId);
    if (!created) {
      throw new Error(`Failed to retrieve newly created control command ${commandId}`);
    }

    return { command: created, isNew: true };
  }

  public async getCommandById(commandId: string): Promise<ControlCommandRecord | null> {
    const [rows] = await this.pool.query<ControlCommandRow[]>(SQL.SELECT_CONTROL_COMMAND_BY_ID, [
      commandId,
    ]);
    if (rows.length === 0 || !rows[0]) {
      return null;
    }
    return mapControlCommandRow(rows[0]);
  }

  public async markExecuting(
    commandId: string,
    acknowledgedBy: string,
  ): Promise<ControlCommandRecord> {
    const [result] = await this.pool.query<ResultSetHeader>(SQL.UPDATE_CONTROL_COMMAND_EXECUTING, [
      acknowledgedBy,
      commandId,
    ]);

    if (result.affectedRows === 0) {
      const current = await this.getCommandById(commandId);
      if (!current) {
        throw new NotFoundError(`Control command ${commandId} not found`);
      }
      return current;
    }

    const updated = await this.getCommandById(commandId);
    return updated!;
  }

  public async markCompleted(
    commandId: string,
    resultPayload?: Record<string, unknown>,
  ): Promise<ControlCommandRecord> {
    const resultJson = resultPayload ? JSON.stringify(resultPayload) : null;
    const [result] = await this.pool.query<ResultSetHeader>(SQL.UPDATE_CONTROL_COMMAND_COMPLETED, [
      resultJson,
      commandId,
    ]);

    if (result.affectedRows === 0) {
      const current = await this.getCommandById(commandId);
      if (!current) {
        throw new NotFoundError(`Control command ${commandId} not found`);
      }
      return current;
    }

    const updated = await this.getCommandById(commandId);
    return updated!;
  }

  public async requestCancellation(commandId: string): Promise<ControlCommandRecord> {
    const current = await this.getCommandById(commandId);
    if (!current) {
      throw new NotFoundError(`Control command ${commandId} not found`);
    }

    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(current.status)) {
      throw new PreconditionFailedError(
        `Cannot cancel command ${commandId} in terminal status '${current.status}'`,
      );
    }

    if (current.status === 'CANCELLATION_REQUESTED') {
      return current;
    }

    await this.pool.query<ResultSetHeader>(SQL.UPDATE_CONTROL_COMMAND_CANCELLATION_REQUESTED, [
      commandId,
    ]);

    const updated = await this.getCommandById(commandId);
    return updated!;
  }

  public async markCancelled(commandId: string, reason?: string): Promise<ControlCommandRecord> {
    const [result] = await this.pool.query<ResultSetHeader>(SQL.UPDATE_CONTROL_COMMAND_CANCELLED, [
      reason ?? null,
      commandId,
    ]);

    if (result.affectedRows === 0) {
      const current = await this.getCommandById(commandId);
      if (!current) {
        throw new NotFoundError(`Control command ${commandId} not found`);
      }
      return current;
    }

    const updated = await this.getCommandById(commandId);
    return updated!;
  }

  public async markFailed(commandId: string, errorMessage: string): Promise<ControlCommandRecord> {
    const [result] = await this.pool.query<ResultSetHeader>(SQL.UPDATE_CONTROL_COMMAND_FAILED, [
      errorMessage,
      commandId,
    ]);

    if (result.affectedRows === 0) {
      const current = await this.getCommandById(commandId);
      if (!current) {
        throw new NotFoundError(`Control command ${commandId} not found`);
      }
      return current;
    }

    const updated = await this.getCommandById(commandId);
    return updated!;
  }

  public async getPendingCommands(limit: number = 50): Promise<ControlCommandRecord[]> {
    const [rows] = await this.pool.query<ControlCommandRow[]>(SQL.SELECT_PENDING_CONTROL_COMMANDS, [
      limit,
    ]);
    return rows.map(mapControlCommandRow);
  }

  public async listRecentCommands(limit: number = 50): Promise<ControlCommandRecord[]> {
    const [rows] = await this.pool.query<ControlCommandRow[]>(SQL.SELECT_RECENT_CONTROL_COMMANDS, [
      limit,
    ]);
    return rows.map(mapControlCommandRow);
  }
}
