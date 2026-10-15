import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fc } from '@chronoscope/testing';
import { InMemoryInboxCheckpointManager } from '@chronoscope/database';

describe('Property 2: Contiguous Kafka Offset Checkpoint & Deduplication (Rule 10)', () => {
  it('proves that arbitrary message redeliveries and offset streams maintain contiguous monotonic high-water mark', async () => {
    const streamArb = fc.record({
      messageCount: fc.integer(5, 25),
      duplicateRate: fc.integer(2, 5),
    });

    await fc.assert(
      streamArb,
      async ({ messageCount, duplicateRate }) => {
        const manager = new InMemoryInboxCheckpointManager();
        const CONSUMER = 'test-projection-consumer';
        const PROJECTION = 'order_summary';
        const TOPIC = 'chronoscope.orders';
        const PARTITION = 0;

        // Generate contiguous message sequence
        const canonicalMessages = Array.from({ length: messageCount }, (_, i) => ({
          eventId: randomUUID(),
          offset: i + 1,
        }));

        // Mix with duplicates
        const deliveredStream: Array<{ eventId: string; offset: number }> = [];
        for (const msg of canonicalMessages) {
          deliveredStream.push(msg);
          if (msg.offset % duplicateRate === 0) {
            deliveredStream.push(msg); // Immediate redelivery
            deliveredStream.push(canonicalMessages[0]!); // Historical redelivery
          }
        }

        let duplicatesDetected = 0;
        let successfulCommits = 0;

        for (const msg of deliveredStream) {
          const res = await manager.recordInboxAndCheckpoint({
            eventId: msg.eventId,
            consumerName: CONSUMER,
            projectionName: PROJECTION,
            topic: TOPIC,
            kafkaPartition: PARTITION,
            kafkaOffset: msg.offset,
          });

          if (res.isDuplicate) {
            duplicatesDetected++;
          } else {
            successfulCommits++;
          }
        }

        // Invariants:
        // 1. Exactly messageCount unique events were committed
        expect(successfulCommits).toBe(messageCount);

        // 2. High-water mark reached exactly messageCount
        const finalCheckpoint = await manager.getCheckpoint(PROJECTION, TOPIC, PARTITION);
        expect(finalCheckpoint).not.toBeNull();
        expect(finalCheckpoint!.kafkaOffset).toBe(messageCount);

        // 3. Duplicate redeliveries were intercepted
        expect(duplicatesDetected).toBeGreaterThanOrEqual(1);

        // 4. All canonical events are recorded in inbox
        for (const msg of canonicalMessages) {
          const inInbox = await manager.isEventInInbox(msg.eventId, CONSUMER);
          expect(inInbox).toBe(true);
        }
      },
      { runs: 30 },
    );
  });
});
