import { describe, expect, it } from 'vitest';
import { InMemoryJobManager, InMemoryJobOutboxLeaseManager } from '@chronoscope/database';
import { InMemoryRabbitMqBus } from '../rabbitmq/in-memory-rabbitmq.js';
import { JobOutboxPublisher } from '../jobs/job-outbox-publisher.js';
import type { RabbitMqDelivery } from '../rabbitmq/types.js';

describe('RabbitMQ Work Queue & Job Outbox Publisher (Rules 8 & 10, ADR-005)', () => {
  it('leases job_outbox records and publishes them to RabbitMQ work queue', async () => {
    const jobManager = new InMemoryJobManager();
    const leaseManager = new InMemoryJobOutboxLeaseManager(jobManager);
    const rabbitBus = new InMemoryRabbitMqBus();

    await jobManager.createJob({
      jobType: 'PROJECTION_REBUILD',
      idempotencyKey: 'rebuild-order-summary-1',
      payload: { projection: 'order_summary', runId: 'run-1' },
      queueName: 'chronoscope.jobs.rebuild',
    });

    const publisher = new JobOutboxPublisher(leaseManager, rabbitBus, {
      workerId: 'outbox-worker-1',
      batchSize: 10,
    });

    const result = await publisher.publishBatch();
    expect(result.publishedCount).toBe(1);
    expect(result.errorCount).toBe(0);

    // Verify outbox status in MySQL/database is PUBLISHED
    expect(jobManager.outboxRecords[0]!.status).toBe('PUBLISHED');

    // Verify message arrived in RabbitMQ queue
    const queued = rabbitBus.getQueueMessages('chronoscope.jobs.rebuild');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toEqual({
      jobId: jobManager.outboxRecords[0]!.jobId,
      jobType: 'PROJECTION_REBUILD',
      idempotencyKey: 'rebuild-order-summary-1',
      payload: { projection: 'order_summary', runId: 'run-1' },
    });
  });

  it('delivers messages to consumers with ack, nack and DLQ routing', async () => {
    const rabbitBus = new InMemoryRabbitMqBus();
    const received: string[] = [];

    await rabbitBus.consume<{ item: string }>(
      'chronoscope.jobs.test',
      async (delivery: RabbitMqDelivery<{ item: string }>) => {
        received.push(delivery.message.payload.item);
        if (delivery.message.payload.item === 'bad-item') {
          // Reject to DLQ
          await delivery.reject();
        } else {
          await delivery.ack();
        }
      },
    );

    await rabbitBus.publish('chronoscope.jobs.test', { item: 'good-item' });
    await rabbitBus.publish('chronoscope.jobs.test', { item: 'bad-item' });

    // Allow microtask queue to process
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toEqual(['good-item', 'bad-item']);
    const dlqMsgs = rabbitBus.getDlqMessages('chronoscope.jobs.test');
    expect(dlqMsgs).toHaveLength(1);
    expect((dlqMsgs[0]?.payload as { item: string }).item).toBe('bad-item');
  });

  it('simulates mid-processing crash and message redelivery', async () => {
    const rabbitBus = new InMemoryRabbitMqBus();
    let deliveryCount = 0;
    let heldDeliveryId: string | null = null;

    await rabbitBus.consume<{ task: string }>('chronoscope.jobs.crash', async (delivery) => {
      deliveryCount += 1;
      heldDeliveryId = delivery.message.id;
      // Simulating crash before calling ack()!
    });

    await rabbitBus.publish('chronoscope.jobs.crash', { task: 'heavy-compute' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(deliveryCount).toBe(1);
    expect(heldDeliveryId).toBeDefined();

    // Trigger redelivery due to unacked crash
    await rabbitBus.simulateCrashRedelivery(heldDeliveryId!);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Consumer received the message a second time with incremented attempt count
    expect(deliveryCount).toBe(2);
  });
});
