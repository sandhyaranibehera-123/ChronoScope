import { existsSync, createReadStream, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // Serve static web dashboard (built SPA in apps/web/dist)
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidateDirs = [
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), 'web/dist'),
    resolve(currentDir, '../../web/dist'),
    resolve(currentDir, '../../../apps/web/dist'),
  ];
  const webDistDir = candidateDirs.find((dir) => existsSync(join(dir, 'index.html')));

  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  };

  if (webDistDir) {
    const indexPath = join(webDistDir, 'index.html');

    app.get('/', async (_req, reply) => {
      reply.type('text/html; charset=utf-8');
      return reply.send(createReadStream(indexPath));
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.url.startsWith('/api') ||
        request.url.startsWith('/health') ||
        request.method !== 'GET'
      ) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Route ${request.method}:${request.url} not found`,
        });
      }

      try {
        const rawPath = request.url.split('?')[0] ?? '/';
        const safePath = join(webDistDir, rawPath.replace(/^\/+/, ''));
        if (existsSync(safePath) && statSync(safePath).isFile()) {
          const ext = extname(safePath).toLowerCase();
          const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
          reply.type(mime);
          if (rawPath.startsWith('/assets/')) {
            reply.header('Cache-Control', 'public, max-age=31536000, immutable');
          }
          return reply.send(createReadStream(safePath));
        }
      } catch {
        // Fall back to index.html for client-side routing
      }

      reply.type('text/html; charset=utf-8');
      return reply.send(createReadStream(indexPath));
    });
  } else {
    app.get('/', async (_req, reply) => {
      return reply.send({
        name: 'CHRONOSCOPE Distributed Laboratory API',
        status: 'online',
        version: '0.1.0',
        docs: '/openapi.json',
        health: '/health/version',
      });
    });
  }

  return app;
}
