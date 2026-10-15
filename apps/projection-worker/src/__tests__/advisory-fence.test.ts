import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryInboxCheckpointManager } from '@chronoscope/database';
import { InMemoryKafkaBus } from '@chronoscope/messaging';
import { InMemoryOrderSummaryRepository } from '@chronoscope/read-store';
import { ProjectionWorker } from '../worker.js';
import { getProjectionPartitionFenceName } from '../fence.js';

describe('ProjectionWorker — Advisory Fence & Status Gating (Rule 17)', () => {
  let orderSummaryRepo: InMemoryOrderSummaryRepository;
  let inboxCheckpointManager: InMemoryInboxCheckpointManager;
  let kafkaBus: InMemoryKafkaBus;
  let worker: ProjectionWorker;

  const timelineId = '00000000-0000-0000-0000-000000000001';
  const aggregateId = 'order-fence-1';

  beforeEach(() => {
    orderSummaryRepo = new InMemoryOrderSummaryRepository();
    inboxCheckpointManager = new InMemoryInboxCheckpointManager();
    kafkaBus = new InMemoryKafkaBus();

    worker = new ProjectionWorker(orderSummaryRepo, inboxCheckpointManager, kafkaBus, {
      projectionName: 'order_summary',
      consumerName: 'order_summary_worker',
    });
  });

  it('generates bounded deterministic advisory fence names <= 64 characters (Rule 17)', () => {
    const longProjectionName =
      'a_very_long_projection_name_that_could_exceed_mysql_identifier_limits';
    const fenceName = getProjectionPartitionFenceName(longProjectionName, 15);

    expect(fenceName.length).toBeLessThanOrEqual(64);
    expect(fenceName).toMatch(/^chronoscope:proj:[a-f0-9]{16}:p15$/);
  });

  it('pauses projection writes when projection status is REBUILDING', async () => {
    // Set projection status to REBUILDING
    inboxCheckpointManager.setProjectionStatus('order_summary', 'REBUILDING');

    const message = {
      topic: 'chronoscope.domain.events',
      key: `${timelineId}:${aggregateId}`,
      partition: 0,
      offset: 200,
      value: {
        eventId: 'ev-rebuilding-1',
        timelineId,
        aggregateId,
        aggregateSequence: 1,
        timelinePosition: 1,
        eventType: 'OrderCreated',
        payload: { currency: 'INR' },
        eventHash: 'h-rebuild',
      },
    };

    await worker.processMessage(message);

    // Verify document was NOT written to Mongo while REBUILDING
    const doc = await orderSummaryRepo.findById(timelineId, aggregateId);
    expect(doc).toBeNull();
    expect(worker.stats.pausedCount).toBe(1);

    // Verify MySQL checkpoint was NOT advanced
    const checkpoint = await inboxCheckpointManager.getCheckpoint(
      'order_summary',
      'chronoscope.domain.events',
      0,
    );
    expect(checkpoint).toBeNull();
  });
});
