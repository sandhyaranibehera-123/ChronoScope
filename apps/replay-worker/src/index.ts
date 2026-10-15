import {
  getMysqlPool,
  MysqlExecutionManager,
  MysqlScenarioInputManager,
  MySqlAggregateRepository,
  MysqlSnapshotMetadataManager,
} from '@chronoscope/database';
import {
  LiveReplayService,
  CounterfactualReplayService,
  AuthoritativeStateResolver,
  MysqlEventReader,
  SnapshotManager,
  InMemorySnapshotStorage,
} from '@chronoscope/replay-engine';
import { createLogger } from '@chronoscope/observability';
import { ReplayWorkerServiceImpl } from './service.js';
import { createReplayWorkerServer } from './server.js';

const logger = createLogger({ name: 'replay-worker-main' });

async function main(): Promise<void> {
  const port = process.env['REPLAY_WORKER_PORT']
    ? Number(process.env['REPLAY_WORKER_PORT'])
    : 50051;
  logger.info({ port }, 'Bootstrapping Replay Worker gRPC service...');

  const pool = getMysqlPool();
  const executionManager = new MysqlExecutionManager(pool);
  const scenarioInputManager = new MysqlScenarioInputManager(pool);
  const aggregateRepository = new MySqlAggregateRepository(pool, 'Order');

  const eventReader = new MysqlEventReader(pool);
  const stateResolver = new AuthoritativeStateResolver(eventReader);
  const snapshotStorage = new InMemorySnapshotStorage();
  const snapshotMetadataManager = new MysqlSnapshotMetadataManager(pool);

  const snapshotManager = new SnapshotManager(
    snapshotMetadataManager,
    snapshotStorage,
    stateResolver,
  );

  const liveStateProvider = {
    getLiveState: async (timelineId: string, aggregateId: string) => {
      const stateRow = await aggregateRepository.load(timelineId, aggregateId);
      if (!stateRow) return null;
      return {
        sequence: stateRow.sequence,
        state: stateRow.state,
        stateHash: stateRow.stateHash,
      };
    },
  };

  const liveReplayService = new LiveReplayService(
    eventReader,
    executionManager,
    snapshotManager,
    liveStateProvider,
  );

  const counterfactualReplayService = new CounterfactualReplayService(
    eventReader,
    executionManager,
    scenarioInputManager,
    liveStateProvider,
  );

  const service = new ReplayWorkerServiceImpl(liveReplayService, counterfactualReplayService);

  const server = createReplayWorkerServer(service);
  const boundPort = await server.start(port);
  logger.info({ port: boundPort }, 'Replay Worker gRPC server is ready to receive requests.');

  const shutdown = async () => {
    logger.info('Shutting down Replay Worker gRPC server...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.fatal({ err }, 'Fatal error starting replay worker');
    process.exit(1);
  });
}
