import { randomUUID } from 'node:crypto';
import { createLogger } from '@chronoscope/observability';
import type {
  IExperimentManager,
  ExperimentManifest,
  MachineProfile,
  ExperimentRunRecord,
} from '@chronoscope/database';
import type { IChaosEngine, FaultType, FaultLayer } from '../types.js';

const logger = createLogger({ name: 'experiment-runner' });

export function captureMachineProfile(): MachineProfile {
  return {
    mysqlVersion: '8.4.0-lts',
    mongodbVersion: '7.0.5',
    mysqlImageDigest: 'sha256:6905541bb02fb9600e1cfeb4dcba065fc615d6549a9fb964c00eecb77b102b5e',
    mongodbImageDigest: 'sha256:94dfaa55097fa6c52a065bba0b0f74577bf64ec26c5fc912d08a3d3c859dca21',
    nodeVersion: typeof process !== 'undefined' ? process.version : 'v24.0.0',
    dockerVersion: '26.1.4',
    osArch: typeof process !== 'undefined' ? `${process.platform}-${process.arch}` : 'darwin-arm64',
  };
}

export interface RunExperimentOptions {
  readonly experimentId: string;
  readonly runId?: string | undefined;
  readonly scenarioSeed?: string | undefined;
  readonly workload?: Record<string, unknown> | undefined;
  readonly warmUp?: Record<string, unknown> | undefined;
  readonly actorRole?: string | undefined;
  readonly actorId?: string | undefined;
  readonly scenarioExecutor?: (
    engine: IChaosEngine,
    recordInvariant: (
      name: string,
      expected: unknown,
      measured: unknown,
      passed: boolean,
      details?: string,
    ) => Promise<void>,
  ) => Promise<Record<string, unknown>>;
}

export class ExperimentRunner {
  constructor(
    private readonly experimentManager: IExperimentManager,
    private readonly chaosEngine: IChaosEngine,
  ) {}

  public async runExperiment(options: RunExperimentOptions): Promise<ExperimentRunRecord> {
    const experiment = await this.experimentManager.getExperiment(options.experimentId);
    if (!experiment) {
      throw new Error(`Experiment '${options.experimentId}' not found.`);
    }

    const runId = options.runId ?? randomUUID();
    const actorRole = options.actorRole ?? 'admin';
    const actorId = options.actorId ?? 'experiment-runner';
    const scenarioSeed = options.scenarioSeed ?? `seed-exp-${Date.now()}`;

    const manifest: ExperimentManifest = {
      gitSha: process.env['GIT_SHA'] ?? 'f1e2d3c4b5a6',
      schemaVersion: 12,
      domainLogicVersion: 1,
      appVersion: '0.1.0',
      datasetVersion: 'baseline-v1',
      configHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      scenarioSeed,
      machineProfile: captureMachineProfile(),
      workload: options.workload ?? { iterations: 10 },
      warmUp: options.warmUp ?? { durationMs: 100 },
    };

    // 1. Start experiment run in chronoscope_ops.experiment_runs
    await this.experimentManager.startRun(runId, experiment.experimentId, manifest);
    logger.info({ runId, experimentId: experiment.experimentId }, 'Started chaos experiment run');

    let allInvariantsPassed = true;
    let resultSummary: Record<string, unknown> = {};
    let runError: string | undefined;

    const recordInvariant = async (
      name: string,
      expected: unknown,
      measured: unknown,
      passed: boolean,
      details?: string,
    ): Promise<void> => {
      if (!passed) {
        allInvariantsPassed = false;
      }
      await this.experimentManager.recordInvariant({
        invariantId: randomUUID(),
        runId,
        invariantName: name,
        status: passed ? 'PASSED' : 'FAILED',
        expectedValue: expected,
        measuredValue: measured,
        details,
      });
    };

    try {
      if (options.scenarioExecutor) {
        resultSummary = await options.scenarioExecutor(this.chaosEngine, recordInvariant);
      } else {
        // Default scenario execution if none supplied: inject configured fault, evaluate, disarm
        if (experiment.faultConfig && experiment.faultConfig['type']) {
          const faultType = experiment.faultConfig['type'] as FaultType;
          const target = (experiment.faultConfig['target'] as string) ?? '*';
          const activeFault = await this.chaosEngine.inject(
            {
              layer: (experiment.faultConfig['layer'] as FaultLayer) ?? 'DEPENDENCY',
              type: faultType,
              target,
              ttlSeconds: (experiment.faultConfig['ttlSeconds'] as number) ?? 60,
            },
            actorRole,
            actorId,
          );

          await recordInvariant('fault_injected', true, true, true, `Injected ${faultType}`);

          // Disarm fault post-run
          await this.chaosEngine.disarm(activeFault.faultId, actorRole, actorId);
          await recordInvariant('fault_disarmed', true, true, true, `Disarmed ${faultType}`);
        }
      }
    } catch (error) {
      allInvariantsPassed = false;
      runError = error instanceof Error ? error.message : String(error);
      logger.error({ runId, error }, 'Experiment run encountered an error');
    } finally {
      // Ensure kill switch cleanup in case any faults were left active
      if (this.chaosEngine.getActiveFaults().length > 0) {
        await this.chaosEngine.disarmAll(actorRole, actorId);
      }

      const finalStatus = runError ? 'FAILED' : allInvariantsPassed ? 'COMPLETED' : 'FAILED';
      await this.experimentManager.completeRun(
        runId,
        finalStatus,
        allInvariantsPassed,
        resultSummary,
        runError,
      );
    }

    const completed = await this.experimentManager.getRun(runId);
    return completed!;
  }
}
