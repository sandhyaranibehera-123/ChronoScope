import type { Pool, RowDataPacket } from 'mysql2/promise';
import { NotFoundError } from '@chronoscope/domain';
import { SQL } from '../sql/statements.js';
import type {
  IExperimentManager,
  ExperimentRecord,
  ExperimentRunRecord,
  ExperimentInvariantRecord,
  ExperimentManifest,
  ExperimentRunStatus,
  ExperimentCategory,
  ExperimentInvariantStatus,
} from './types.js';

interface ExperimentRow extends RowDataPacket {
  experiment_id: string;
  name: string;
  category: ExperimentCategory;
  description: string;
  hypothesis: string;
  steady_state_invariants: string | Record<string, unknown>;
  fault_config: string | Record<string, unknown> | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface ExperimentRunRow extends RowDataPacket {
  run_id: string;
  experiment_id: string;
  status: ExperimentRunStatus;
  manifest: string | ExperimentManifest;
  started_at: string | Date;
  completed_at: string | Date | null;
  invariants_passed: number | boolean;
  result_summary: string | Record<string, unknown> | null;
  error_message: string | null;
  created_at: string | Date;
}

interface ExperimentInvariantRow extends RowDataPacket {
  invariant_id: string;
  run_id: string;
  invariant_name: string;
  status: ExperimentInvariantStatus;
  expected_value: string | unknown;
  measured_value: string | unknown;
  details: string | null;
  evaluated_at: string | Date;
}

function parseJsonField<T>(field: string | T | null | undefined): T | undefined {
  if (field === null || field === undefined) return undefined;
  if (typeof field === 'string') {
    try {
      return JSON.parse(field) as T;
    } catch {
      return field as unknown as T;
    }
  }
  return field;
}

function mapExperimentRow(row: ExperimentRow): ExperimentRecord {
  return {
    experimentId: row.experiment_id,
    name: row.name,
    category: row.category,
    description: row.description,
    hypothesis: row.hypothesis,
    steadyStateInvariants:
      parseJsonField<Record<string, unknown>>(row.steady_state_invariants) ?? {},
    faultConfig: parseJsonField<Record<string, unknown>>(row.fault_config),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapExperimentRunRow(row: ExperimentRunRow): ExperimentRunRecord {
  return {
    runId: row.run_id,
    experimentId: row.experiment_id,
    status: row.status,
    manifest: parseJsonField<ExperimentManifest>(row.manifest)!,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    invariantsPassed: Boolean(row.invariants_passed),
    resultSummary: parseJsonField<Record<string, unknown>>(row.result_summary),
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

function mapInvariantRow(row: ExperimentInvariantRow): ExperimentInvariantRecord {
  return {
    invariantId: row.invariant_id,
    runId: row.run_id,
    invariantName: row.invariant_name,
    status: row.status,
    expectedValue: parseJsonField(row.expected_value),
    measuredValue: parseJsonField(row.measured_value),
    details: row.details ?? undefined,
    evaluatedAt: new Date(row.evaluated_at),
  };
}

export class MysqlExperimentManager implements IExperimentManager {
  constructor(private readonly pool: Pool) {}

  public async registerExperiment(experiment: ExperimentRecord): Promise<void> {
    await this.pool.execute(SQL.INSERT_EXPERIMENT, [
      experiment.experimentId,
      experiment.name,
      experiment.category,
      experiment.description,
      experiment.hypothesis,
      JSON.stringify(experiment.steadyStateInvariants),
      experiment.faultConfig ? JSON.stringify(experiment.faultConfig) : null,
    ]);
  }

  public async getExperiment(experimentId: string): Promise<ExperimentRecord | null> {
    const [rows] = await this.pool.query<ExperimentRow[]>(SQL.SELECT_EXPERIMENT_BY_ID, [
      experimentId,
    ]);
    if (rows.length === 0 || !rows[0]) {
      return null;
    }
    return mapExperimentRow(rows[0]);
  }

  public async listExperiments(): Promise<ExperimentRecord[]> {
    const [rows] = await this.pool.query<ExperimentRow[]>(SQL.SELECT_ALL_EXPERIMENTS);
    return rows.map(mapExperimentRow);
  }

  public async startRun(
    runId: string,
    experimentId: string,
    manifest: ExperimentManifest,
  ): Promise<ExperimentRunRecord> {
    const experiment = await this.getExperiment(experimentId);
    if (!experiment) {
      throw new NotFoundError('Experiment', experimentId);
    }

    await this.pool.execute(SQL.INSERT_EXPERIMENT_RUN, [
      runId,
      experimentId,
      JSON.stringify(manifest),
    ]);

    const created = await this.getRun(runId);
    if (!created) {
      throw new Error(`Failed to retrieve newly created experiment run ${runId}`);
    }
    return created;
  }

  public async completeRun(
    runId: string,
    status: ExperimentRunStatus,
    invariantsPassed: boolean,
    resultSummary?: Record<string, unknown>,
    errorMessage?: string,
  ): Promise<void> {
    await this.pool.execute(SQL.UPDATE_EXPERIMENT_RUN_COMPLETED, [
      status,
      invariantsPassed ? 1 : 0,
      resultSummary ? JSON.stringify(resultSummary) : null,
      errorMessage ?? null,
      runId,
    ]);
  }

  public async getRun(runId: string): Promise<ExperimentRunRecord | null> {
    const [rows] = await this.pool.query<ExperimentRunRow[]>(SQL.SELECT_EXPERIMENT_RUN_BY_ID, [
      runId,
    ]);
    if (rows.length === 0 || !rows[0]) {
      return null;
    }
    return mapExperimentRunRow(rows[0]);
  }

  public async listRecentRuns(limit: number = 20): Promise<ExperimentRunRecord[]> {
    const [rows] = await this.pool.query<ExperimentRunRow[]>(SQL.SELECT_RECENT_EXPERIMENT_RUNS, [
      limit,
    ]);
    return rows.map(mapExperimentRunRow);
  }

  public async recordInvariant(invariant: ExperimentInvariantRecord): Promise<void> {
    await this.pool.execute(SQL.INSERT_EXPERIMENT_INVARIANT, [
      invariant.invariantId,
      invariant.runId,
      invariant.invariantName,
      invariant.status,
      JSON.stringify(invariant.expectedValue),
      JSON.stringify(invariant.measuredValue),
      invariant.details ?? null,
    ]);
  }

  public async getRunInvariants(runId: string): Promise<ExperimentInvariantRecord[]> {
    const [rows] = await this.pool.query<ExperimentInvariantRow[]>(
      SQL.SELECT_EXPERIMENT_INVARIANTS_BY_RUN_ID,
      [runId],
    );
    return rows.map(mapInvariantRow);
  }
}
