import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ConcurrencyConflictError, NotFoundError } from '@chronoscope/domain';
import { SQL } from '../sql/statements.js';
import type {
  IWorkerControlManager,
  WorkerControlRecord,
  SetDesiredStateOptions,
  WorkerControlStatus,
} from './types.js';

interface WorkerControlRow extends RowDataPacket {
  control_target: string;
  status: WorkerControlStatus;
  concurrency: number | string;
  config: string | Record<string, unknown> | null;
  version: number | string;
  updated_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapWorkerControlRow(row: WorkerControlRow): WorkerControlRecord {
  const config =
    row.config === null
      ? null
      : typeof row.config === 'string'
        ? JSON.parse(row.config)
        : (row.config as Record<string, unknown>);

  return {
    controlTarget: row.control_target,
    status: row.status,
    concurrency: Number(row.concurrency),
    config,
    version: Number(row.version),
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class MysqlWorkerControlManager implements IWorkerControlManager {
  constructor(private readonly pool: Pool) {}

  public async get(controlTarget: string): Promise<WorkerControlRecord | null> {
    const [rows] = await this.pool.query<WorkerControlRow[]>(SQL.SELECT_WORKER_CONTROL, [
      controlTarget,
    ]);
    if (rows.length === 0 || !rows[0]) {
      return null;
    }
    return mapWorkerControlRow(rows[0]);
  }

  public async list(): Promise<WorkerControlRecord[]> {
    const [rows] = await this.pool.query<WorkerControlRow[]>(SQL.SELECT_ALL_WORKER_CONTROLS);
    return rows.map(mapWorkerControlRow);
  }

  public async initTarget(
    controlTarget: string,
    initial?: Partial<WorkerControlRecord>,
  ): Promise<WorkerControlRecord> {
    const existing = await this.get(controlTarget);
    if (existing) {
      return existing;
    }

    const status = initial?.status ?? 'ACTIVE';
    const concurrency = initial?.concurrency ?? 1;
    const config = initial?.config ? JSON.stringify(initial.config) : null;
    const version = 1;
    const updatedBy = initial?.updatedBy ?? 'system';

    await this.pool.query<ResultSetHeader>(SQL.INSERT_WORKER_CONTROL, [
      controlTarget,
      status,
      concurrency,
      config,
      version,
      updatedBy,
    ]);

    const created = await this.get(controlTarget);
    if (!created) {
      throw new Error(`Failed to initialize worker control target ${controlTarget}`);
    }
    return created;
  }

  public async setDesiredState(
    controlTarget: string,
    options: SetDesiredStateOptions,
  ): Promise<WorkerControlRecord> {
    const current = await this.get(controlTarget);
    if (!current) {
      throw new NotFoundError(
        `Worker control target '${controlTarget}' not found`,
        'ERR_WORKER_CONTROL_NOT_FOUND',
        { controlTarget },
      );
    }

    if (current.version !== options.expectedVersion) {
      throw new ConcurrencyConflictError(
        `OCC version mismatch for worker control '${controlTarget}': expected version ${options.expectedVersion}, but current version is ${current.version}`,
        'ERR_WORKER_CONTROL_OCC_CONFLICT',
        {
          controlTarget,
          expectedVersion: options.expectedVersion,
          currentVersion: current.version,
        },
      );
    }

    const nextStatus = options.status ?? current.status;
    const nextConcurrency = options.concurrency ?? current.concurrency;
    const nextConfig =
      options.config !== undefined
        ? options.config === null
          ? null
          : JSON.stringify(options.config)
        : current.config === null
          ? null
          : JSON.stringify(current.config);
    const updatedBy = options.updatedBy ?? 'operator';

    const [result] = await this.pool.query<ResultSetHeader>(SQL.UPDATE_WORKER_CONTROL_OCC, [
      nextStatus,
      nextConcurrency,
      nextConfig,
      updatedBy,
      controlTarget,
      options.expectedVersion,
    ]);

    if (result.affectedRows === 0) {
      throw new ConcurrencyConflictError(
        `Concurrent OCC conflict updating worker control '${controlTarget}' at version ${options.expectedVersion}`,
        'ERR_WORKER_CONTROL_OCC_CONFLICT',
        { controlTarget, expectedVersion: options.expectedVersion },
      );
    }

    const updated = await this.get(controlTarget);
    if (!updated) {
      throw new Error(`Failed to read back updated worker control for ${controlTarget}`);
    }
    return updated;
  }
}
