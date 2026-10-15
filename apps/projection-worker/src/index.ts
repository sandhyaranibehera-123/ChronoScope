import { getMysqlPool, MysqlInboxCheckpointManager } from '@chronoscope/database';
import { KafkaJsConsumer } from '@chronoscope/messaging';
import { createLogger } from '@chronoscope/observability';
import { getMongoDatabase, MongoOrderSummaryRepository } from '@chronoscope/read-store';
import { ProjectionWorker } from './worker.js';

const logger = createLogger({ name: 'projection-worker-app' });

async function main(): Promise<void> {
  logger.info('Starting projection worker...');

  const pool = getMysqlPool();
  const db = getMongoDatabase();

  const inboxCheckpointManager = new MysqlInboxCheckpointManager(pool);
  const orderSummaryRepo = new MongoOrderSummaryRepository(db);
  const consumer = new KafkaJsConsumer();

  const worker = new ProjectionWorker(orderSummaryRepo, inboxCheckpointManager, consumer, {
    projectionName: 'order_summary',
    consumerName: 'order_summary_worker',
  });

  await consumer.connect();
  await worker.start(['chronoscope.domain.events']);

  logger.info('Projection worker active and consuming events.');

  const shutdown = async () => {
    logger.info('Shutting down projection worker...');
    await consumer.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.fatal({ err }, 'Fatal error in projection worker');
    process.exit(1);
  });
}

export * from './fence.js';
export * from './worker.js';
