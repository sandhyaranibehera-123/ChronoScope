import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';

export interface ScenarioInputRecord {
  readonly inputId: string;
  readonly timelineId: string;
  readonly aggregateId: string | null;
  readonly inputType: string;
  readonly parameters: Readonly<Record<string, unknown>> | null;
  readonly applied: boolean;
  readonly createdAt: string;
}

export interface CreateScenarioInputParams {
  readonly inputId?: string;
  readonly timelineId: string;
  readonly aggregateId?: string | null;
  readonly inputType: string;
  readonly parameters?: Record<string, unknown> | null;
}

export interface IScenarioInputManager {
  recordInput(params: CreateScenarioInputParams): Promise<ScenarioInputRecord>;
  getInputsByTimeline(timelineId: string): Promise<readonly ScenarioInputRecord[]>;
  markApplied(inputId: string): Promise<void>;
}

interface ScenarioInputRow extends RowDataPacket {
  input_id: string;
  timeline_id: string;
  aggregate_id: string | null;
  input_type: string;
  parameters: string | Record<string, unknown> | null;
  applied: number | boolean;
  created_at: string;
}

export class MysqlScenarioInputManager implements IScenarioInputManager {
  constructor(private readonly pool: Pool) {}

  public async recordInput(params: CreateScenarioInputParams): Promise<ScenarioInputRecord> {
    const inputId = params.inputId ?? randomUUID();
    const aggregateId = params.aggregateId ?? null;
    const parametersJson = params.parameters ? JSON.stringify(params.parameters) : null;

    await this.pool.query(SQL.INSERT_SCENARIO_INPUT, [
      inputId,
      params.timelineId,
      aggregateId,
      params.inputType,
      parametersJson,
      false,
    ]);

    return {
      inputId,
      timelineId: params.timelineId,
      aggregateId,
      inputType: params.inputType,
      parameters: params.parameters ?? null,
      applied: false,
      createdAt: new Date().toISOString(),
    };
  }

  public async getInputsByTimeline(timelineId: string): Promise<readonly ScenarioInputRecord[]> {
    const [rows] = await this.pool.query<ScenarioInputRow[]>(
      SQL.SELECT_SCENARIO_INPUTS_BY_TIMELINE,
      [timelineId],
    );

    return rows.map((r) => {
      let params = r.parameters;
      if (typeof params === 'string') {
        try {
          params = JSON.parse(params);
        } catch {
          params = null;
        }
      }

      return {
        inputId: r.input_id,
        timelineId: r.timeline_id,
        aggregateId: r.aggregate_id,
        inputType: r.input_type,
        parameters: (params as Record<string, unknown>) ?? null,
        applied: Boolean(r.applied),
        createdAt: r.created_at,
      };
    });
  }

  public async markApplied(inputId: string): Promise<void> {
    await this.pool.query(SQL.MARK_SCENARIO_INPUT_APPLIED, [inputId]);
  }
}

export class InMemoryScenarioInputManager implements IScenarioInputManager {
  private readonly inputs: ScenarioInputRecord[] = [];

  public async recordInput(params: CreateScenarioInputParams): Promise<ScenarioInputRecord> {
    const record: ScenarioInputRecord = {
      inputId: params.inputId ?? randomUUID(),
      timelineId: params.timelineId,
      aggregateId: params.aggregateId ?? null,
      inputType: params.inputType,
      parameters: params.parameters ? JSON.parse(JSON.stringify(params.parameters)) : null,
      applied: false,
      createdAt: new Date().toISOString(),
    };

    this.inputs.push(record);
    return record;
  }

  public async getInputsByTimeline(timelineId: string): Promise<readonly ScenarioInputRecord[]> {
    return this.inputs
      .filter((i) => i.timelineId === timelineId)
      .map((i) => JSON.parse(JSON.stringify(i)));
  }

  public async markApplied(inputId: string): Promise<void> {
    const idx = this.inputs.findIndex((i) => i.inputId === inputId);
    if (idx !== -1) {
      const existing = this.inputs[idx]!;
      this.inputs[idx] = {
        ...existing,
        applied: true,
      };
    }
  }

  public clear(): void {
    this.inputs.length = 0;
  }
}
