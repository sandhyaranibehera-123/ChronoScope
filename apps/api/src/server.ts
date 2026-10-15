import Fastify, { type FastifyInstance } from 'fastify';
import type { AggregateRepository, OrderState } from '@chronoscope/domain';
import type {
  ICommandDeduplicationManager,
  IExecutionManager,
  IJobManager,
  IWorkerControlManager,
  IControlCommandManager,
} from '@chronoscope/database';
import type { ControlDispatcher } from '@chronoscope/messaging';
import type { IOrderSummaryRepository } from '@chronoscope/read-store';
import type {
  LiveReplayService,
  SnapshotManager,
  TimelineForkService,
  CounterfactualReplayService,
  TimelineDiffEngine,
  CausalGraphEngine,
  IReplayWorkerClient,
} from '@chronoscope/replay-engine';
import type { IScenarioInputManager } from '@chronoscope/database';
import { getEnv } from './config/env.js';
import corsPlugin from './plugins/cors.js';
import helmetPlugin from './plugins/helmet.js';
import sensiblePlugin from './plugins/sensible.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import { commandRoutes } from './routes/commands.js';
import { queryRoutes } from './routes/queries.js';
import { openapiRoutes } from './routes/openapi.js';
import { replayRoutes } from './routes/replay.js';
import { snapshotRoutes } from './routes/snapshots.js';
import { timelineRoutes } from './routes/timelines.js';
import { causalRoutes } from './routes/causal.js';
import { jobRoutes } from './routes/jobs.js';
import { controlRoutes } from './routes/controls.js';
import { chaosRoutes } from './routes/chaos.js';
import { experimentRoutes } from './routes/experiments.js';
import type { IChaosEngine, ExperimentRunner } from '@chronoscope/chaos';
import type { IExperimentManager, IAuditLogger } from '@chronoscope/database';

export interface ServerDependencies {
  orderRepository?: AggregateRepository<OrderState> | undefined;
  commandDedupManager?: ICommandDeduplicationManager | undefined;
  orderSummaryRepository?: IOrderSummaryRepository | undefined;
  liveReplayService?: LiveReplayService | undefined;
  snapshotManager?: SnapshotManager | undefined;
  executionManager?: IExecutionManager | undefined;
  timelineForkService?: TimelineForkService | undefined;
  scenarioInputManager?: IScenarioInputManager | undefined;
  counterfactualReplayService?: CounterfactualReplayService | undefined;
  timelineDiffEngine?: TimelineDiffEngine | undefined;
  causalGraphEngine?: CausalGraphEngine | undefined;
  jobManager?: IJobManager | undefined;
  replayWorkerClient?: IReplayWorkerClient | undefined;
  workerControlManager?: IWorkerControlManager | undefined;
  controlCommandManager?: IControlCommandManager | undefined;
  controlDispatcher?: ControlDispatcher | undefined;
  chaosEngine?: IChaosEngine | undefined;
  experimentManager?: IExperimentManager | undefined;
  experimentRunner?: ExperimentRunner | undefined;
  auditLogger?: IAuditLogger | undefined;
}

/**
 * Builds a fully-configured Fastify instance without starting it listening —
 * testable in isolation (Rules 1, 2, 7, 8, 10, 24).
 */
export async function buildServer(deps?: ServerDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: getEnv().LOG_LEVEL } });

  await app.register(sensiblePlugin);
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(authPlugin);
  await app.register(healthRoutes);

  // CQRS write and read paths (Phase 5)
  await app.register(commandRoutes, {
    orderRepository: deps?.orderRepository,
    commandDedupManager: deps?.commandDedupManager,
  });

  await app.register(queryRoutes, {
    orderSummaryRepository: deps?.orderSummaryRepository,
  });

  await app.register(openapiRoutes);

  // Replay and Snapshot paths (Phase 6 & 9)
  await app.register(replayRoutes, {
    liveReplayService: deps?.liveReplayService,
    executionManager: deps?.executionManager,
    replayWorkerClient: deps?.replayWorkerClient,
  });

  await app.register(snapshotRoutes, {
    snapshotManager: deps?.snapshotManager,
  });

  // Timeline DAG, Counterfactual & Diff paths (Phase 7)
  await app.register(timelineRoutes, {
    timelineForkService: deps?.timelineForkService,
    scenarioInputManager: deps?.scenarioInputManager,
    counterfactualReplayService: deps?.counterfactualReplayService,
    timelineDiffEngine: deps?.timelineDiffEngine,
  });

  // Causal Graph paths (Phase 8)
  await app.register(causalRoutes, {
    causalGraphEngine: deps?.causalGraphEngine,
  });

  // Background Jobs paths (Phase 9)
  await app.register(jobRoutes, {
    jobManager: deps?.jobManager,
  });

  // Control Plane paths (Phase 10)
  await app.register(controlRoutes, {
    workerControlManager: deps?.workerControlManager,
    controlCommandManager: deps?.controlCommandManager,
    controlDispatcher: deps?.controlDispatcher,
  });

  // Chaos Engine & Experiments paths (Phase 11)
  await app.register(chaosRoutes, {
    chaosEngine: deps?.chaosEngine,
  });

  await app.register(experimentRoutes, {
    experimentManager: deps?.experimentManager,
    experimentRunner: deps?.experimentRunner,
  });

  return app;
}
