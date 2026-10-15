// packages/database/src/experiments/types.ts
// Phase 11: Experiments & Chaos Experiment Management (Rules 21 & 22)

export type ExperimentCategory = 'CHAOS' | 'CONCURRENCY' | 'CONSISTENCY' | 'RECOVERY' | 'REPLAY';

export type ExperimentRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED';

export type ExperimentInvariantStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

/**
 * Machine profile pinned to exact patch versions and container image digests (Rule 22).
 */
export interface MachineProfile {
  readonly mysqlVersion: string;
  readonly mongodbVersion: string;
  readonly mysqlImageDigest: string;
  readonly mongodbImageDigest: string;
  readonly nodeVersion: string;
  readonly dockerVersion: string;
  readonly osArch: string;
}

/**
 * Complete reproducibility manifest for an experiment run (Rule 22).
 */
export interface ExperimentManifest {
  readonly gitSha: string;
  readonly schemaVersion: number;
  readonly domainLogicVersion: number;
  readonly appVersion: string;
  readonly datasetVersion: string;
  readonly configHash: string;
  readonly scenarioSeed: string;
  readonly machineProfile: MachineProfile;
  readonly workload?: Record<string, unknown> | undefined;
  readonly warmUp?: Record<string, unknown> | undefined;
}

export interface ExperimentRecord {
  readonly experimentId: string;
  readonly name: string;
  readonly category: ExperimentCategory;
  readonly description: string;
  readonly hypothesis: string;
  readonly steadyStateInvariants: Record<string, unknown>;
  readonly faultConfig?: Record<string, unknown> | undefined;
  readonly createdAt?: Date | undefined;
  readonly updatedAt?: Date | undefined;
}

export interface ExperimentRunRecord {
  readonly runId: string;
  readonly experimentId: string;
  readonly status: ExperimentRunStatus;
  readonly manifest: ExperimentManifest;
  readonly startedAt: Date;
  readonly completedAt?: Date | undefined;
  readonly invariantsPassed: boolean;
  readonly resultSummary?: Record<string, unknown> | undefined;
  readonly errorMessage?: string | undefined;
  readonly createdAt?: Date | undefined;
}

export interface ExperimentInvariantRecord {
  readonly invariantId: string;
  readonly runId: string;
  readonly invariantName: string;
  readonly status: ExperimentInvariantStatus;
  readonly expectedValue: unknown;
  readonly measuredValue: unknown;
  readonly details?: string | undefined;
  readonly evaluatedAt?: Date | undefined;
}

export interface IExperimentManager {
  registerExperiment(experiment: ExperimentRecord): Promise<void>;
  getExperiment(experimentId: string): Promise<ExperimentRecord | null>;
  listExperiments(): Promise<ExperimentRecord[]>;
  startRun(
    runId: string,
    experimentId: string,
    manifest: ExperimentManifest,
  ): Promise<ExperimentRunRecord>;
  completeRun(
    runId: string,
    status: ExperimentRunStatus,
    invariantsPassed: boolean,
    resultSummary?: Record<string, unknown>,
    errorMessage?: string,
  ): Promise<void>;
  getRun(runId: string): Promise<ExperimentRunRecord | null>;
  listRecentRuns(limit?: number): Promise<ExperimentRunRecord[]>;
  recordInvariant(invariant: ExperimentInvariantRecord): Promise<void>;
  getRunInvariants(runId: string): Promise<ExperimentInvariantRecord[]>;
}
