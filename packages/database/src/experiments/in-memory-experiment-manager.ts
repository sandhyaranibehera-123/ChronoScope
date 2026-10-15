import { NotFoundError } from '@chronoscope/domain';
import type {
  IExperimentManager,
  ExperimentRecord,
  ExperimentRunRecord,
  ExperimentInvariantRecord,
  ExperimentManifest,
  ExperimentRunStatus,
} from './types.js';

export class InMemoryExperimentManager implements IExperimentManager {
  private readonly experiments = new Map<string, ExperimentRecord>();
  private readonly runs = new Map<string, ExperimentRunRecord>();
  private readonly invariants = new Map<string, ExperimentInvariantRecord[]>();

  public async registerExperiment(experiment: ExperimentRecord): Promise<void> {
    this.experiments.set(experiment.experimentId, {
      ...experiment,
      createdAt: experiment.createdAt ?? new Date(),
      updatedAt: new Date(),
    });
  }

  public async getExperiment(experimentId: string): Promise<ExperimentRecord | null> {
    return this.experiments.get(experimentId) ?? null;
  }

  public async listExperiments(): Promise<ExperimentRecord[]> {
    return Array.from(this.experiments.values());
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

    const run: ExperimentRunRecord = {
      runId,
      experimentId,
      status: 'RUNNING',
      manifest,
      startedAt: new Date(),
      invariantsPassed: false,
      createdAt: new Date(),
    };
    this.runs.set(runId, run);
    return run;
  }

  public async completeRun(
    runId: string,
    status: ExperimentRunStatus,
    invariantsPassed: boolean,
    resultSummary?: Record<string, unknown>,
    errorMessage?: string,
  ): Promise<void> {
    const existing = this.runs.get(runId);
    if (!existing) {
      throw new NotFoundError('ExperimentRun', runId);
    }

    this.runs.set(runId, {
      ...existing,
      status,
      completedAt: new Date(),
      invariantsPassed,
      resultSummary,
      errorMessage,
    });
  }

  public async getRun(runId: string): Promise<ExperimentRunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  public async listRecentRuns(limit: number = 20): Promise<ExperimentRunRecord[]> {
    return Array.from(this.runs.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  public async recordInvariant(invariant: ExperimentInvariantRecord): Promise<void> {
    const list = this.invariants.get(invariant.runId) ?? [];
    list.push({
      ...invariant,
      evaluatedAt: invariant.evaluatedAt ?? new Date(),
    });
    this.invariants.set(invariant.runId, list);
  }

  public async getRunInvariants(runId: string): Promise<ExperimentInvariantRecord[]> {
    return this.invariants.get(runId) ?? [];
  }
}
