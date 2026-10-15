import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fc } from '@chronoscope/testing';
import {
  InMemoryOrderSummaryRepository,
  computeProjectionHash,
  type OrderSummaryDocument,
} from '@chronoscope/read-store';

describe('Property 1: MongoDB Sequence Guard Idempotency & Convergence (Rule 10)', () => {
  const TIMELINE_ID = '00000000-0000-0000-0000-000000000001';

  it('proves that arbitrary delivery interleavings and duplicates always converge to identical state and projectionHash', async () => {
    const orderSpecArb = fc.record({
      itemCount: fc.integer(1, 8),
      unitPrice: fc.integer(10, 50),
    });

    await fc.assert(
      orderSpecArb,
      async ({ itemCount, unitPrice }) => {
        const aggregateId = randomUUID();

        // 1. Construct canonical sequence of documents (seq 1 to itemCount + 2)
        const sequenceDocs: OrderSummaryDocument[] = [];

        // Seq 1: OrderCreated
        const doc1: OrderSummaryDocument = {
          _id: `${TIMELINE_ID}:${aggregateId}`,
          timelineId: TIMELINE_ID,
          aggregateId,
          status: 'CREATED',
          items: [],
          totalAmountMinor: 0,
          currency: 'USD',
          appliedSequence: 1,
          appliedTimelinePosition: 1,
          appliedKafkaTopic: 'chronoscope.orders',
          appliedKafkaPartition: 0,
          appliedKafkaOffset: 1,
          appliedEventId: randomUUID(),
          sourceAggregateSequence: 1,
          sourceStateHash: 'hash-state-1'.padEnd(64, '0'),
          projectionHash: '',
          updatedAt: new Date(),
        };
        doc1.projectionHash = computeProjectionHash(doc1 as unknown as Record<string, unknown>);
        sequenceDocs.push(doc1);

        // Seq 2..N+1: OrderItemAdded
        let runningTotal = 0;
        const runningItems: Array<{ sku: string; quantity: number; amountMinor: number }> = [];

        for (let i = 1; i <= itemCount; i++) {
          const qty = i;
          const lineTotal = qty * unitPrice;
          runningTotal += lineTotal;
          runningItems.push({ sku: `SKU-${i}`, quantity: qty, amountMinor: lineTotal });

          const itemDoc: OrderSummaryDocument = {
            _id: `${TIMELINE_ID}:${aggregateId}`,
            timelineId: TIMELINE_ID,
            aggregateId,
            status: 'CREATED',
            items: [...runningItems],
            totalAmountMinor: runningTotal,
            currency: 'USD',
            appliedSequence: i + 1,
            appliedTimelinePosition: i + 1,
            appliedKafkaTopic: 'chronoscope.orders',
            appliedKafkaPartition: 0,
            appliedKafkaOffset: i + 1,
            appliedEventId: randomUUID(),
            sourceAggregateSequence: i + 1,
            sourceStateHash: `hash-state-${i + 1}`.padEnd(64, '0'),
            projectionHash: '',
            updatedAt: new Date(),
          };
          itemDoc.projectionHash = computeProjectionHash(
            itemDoc as unknown as Record<string, unknown>,
          );
          sequenceDocs.push(itemDoc);
        }

        // Seq N+2: OrderConfirmed
        const finalSeq = itemCount + 2;
        const confirmedDoc: OrderSummaryDocument = {
          _id: `${TIMELINE_ID}:${aggregateId}`,
          timelineId: TIMELINE_ID,
          aggregateId,
          status: 'CONFIRMED',
          items: [...runningItems],
          totalAmountMinor: runningTotal,
          currency: 'USD',
          appliedSequence: finalSeq,
          appliedTimelinePosition: finalSeq,
          appliedKafkaTopic: 'chronoscope.orders',
          appliedKafkaPartition: 0,
          appliedKafkaOffset: finalSeq,
          appliedEventId: randomUUID(),
          sourceAggregateSequence: finalSeq,
          sourceStateHash: `hash-state-${finalSeq}`.padEnd(64, '0'),
          projectionHash: '',
          updatedAt: new Date(),
        };
        confirmedDoc.projectionHash = computeProjectionHash(
          confirmedDoc as unknown as Record<string, unknown>,
        );
        sequenceDocs.push(confirmedDoc);

        // Canonical in-order sequential processing
        const refRepo = new InMemoryOrderSummaryRepository();
        for (const doc of sequenceDocs) {
          await refRepo.upsertOrderSummary(doc);
        }
        const canonicalResult = await refRepo.findById(TIMELINE_ID, aggregateId);
        expect(canonicalResult).not.toBeNull();
        expect(canonicalResult!.appliedSequence).toBe(finalSeq);
        expect(canonicalResult!.status).toBe('CONFIRMED');

        // Chaotic stream with duplicate injections
        const chaoticRepo = new InMemoryOrderSummaryRepository();
        const chaoticStream = [...sequenceDocs];
        for (let d = 0; d < 5; d++) {
          const duplicateIndex = (d * 3) % sequenceDocs.length;
          chaoticStream.push(sequenceDocs[duplicateIndex]!);
        }

        for (const msg of chaoticStream) {
          await chaoticRepo.upsertOrderSummary(msg);
        }

        const chaoticResult = await chaoticRepo.findById(TIMELINE_ID, aggregateId);
        expect(chaoticResult).not.toBeNull();
        // INVARIANTS:
        expect(chaoticResult!.appliedSequence).toBe(canonicalResult!.appliedSequence);
        expect(chaoticResult!.status).toBe(canonicalResult!.status);
        expect(chaoticResult!.totalAmountMinor).toBe(canonicalResult!.totalAmountMinor);
        expect(chaoticResult!.items).toHaveLength(canonicalResult!.items.length);
        expect(chaoticResult!.projectionHash).toBe(canonicalResult!.projectionHash);
      },
      { runs: 30 },
    );
  });
});
