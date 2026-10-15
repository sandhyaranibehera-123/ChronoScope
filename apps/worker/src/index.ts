import {
  getMysqlPool,
  OutboxLeaseManager,
  MysqlJobManager,
  JobOutboxLeaseManager,
} from '@chronoscope/database';
import {
  KafkaJsProducer,
  OutboxPublisher,
  RabbitMqClient,
  JobOutboxPublisher,
} from '@chronoscope/messaging';
import { createLogger } from '@chronoscope/observability';
import { JobWorker } from './job-worker.js';
import { WorkerControlListener } from './control-listener.js';

export { JobWorker, WorkerControlListener };

const logger = createLogger({ name: 'chronoscope-worker' });

async function main(): Promise<void> {
  logger.info('Starting chronoscope outbox publisher & background job worker...');

  const pool = getMysqlPool();
  const leaseManager = new OutboxLeaseManager(pool);
  const producer = new KafkaJsProducer();
  const jobManager = new MysqlJobManager(pool);
  const jobLeaseManager = new JobOutboxLeaseManager(pool);
  const rabbitClient = new RabbitMqClient();

  await producer.connect();
  await rabbitClient.connect();

  const domainPublisher = new OutboxPublisher(leaseManager, producer, {
    workerId: `worker-${process.pid}`,
    batchSize: 20,
    leaseDurationSeconds: 30,
    pollIntervalMs: 250,
  });

  const jobPublisher = new JobOutboxPublisher(jobLeaseManager, rabbitClient, {
    workerId: `job-worker-${process.pid}`,
    batchSize: 10,
    leaseDurationSeconds: 30,
    pollIntervalMs: 250,
  });

  const jobWorker = new JobWorker(jobManager, rabbitClient);

  domainPublisher.start();
  jobPublisher.start();
  await jobWorker.start();
  logger.info('Chronoscope background workers active and leasing batches.');

  const shutdown = async () => {
    logger.info('Stopping chronoscope workers...');
    domainPublisher.stop();
    jobPublisher.stop();
    jobWorker.stop();
    await producer.disconnect();
    await rabbitClient.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.fatal({ err }, 'Fatal error in worker daemon');
    process.exit(1);
  });
}
