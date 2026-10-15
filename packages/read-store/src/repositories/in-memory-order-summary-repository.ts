import { computeProjectionHash } from '../hash/projection-hash.js';
import type { OrderSummaryDocument, ProjectionUpsertResult } from '../types.js';
import type { IOrderSummaryRepository } from './order-summary-repository.js';

/**
 * High-fidelity in-memory projection repository for infra-free testing (Rule 24).
 * Replicates composite identity, sequence guard, shadow collection, and rebuild swap.
 */
export class InMemoryOrderSummaryRepository implements IOrderSummaryRepository {
  private readonly documents = new Map<string, OrderSummaryDocument>();
  private readonly shadowDocuments = new Map<string, OrderSummaryDocument>();
  public simulateFirstInsertRace = false;

  public async findById(
    timelineId: string,
    aggregateId: string,
  ): Promise<OrderSummaryDocument | null> {
    const documentId = `${timelineId}:${aggregateId}`;
    const doc = this.documents.get(documentId);
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  public async findByTimeline(timelineId: string): Promise<OrderSummaryDocument[]> {
    const docs: OrderSummaryDocument[] = [];
    for (const doc of this.documents.values()) {
      if (doc.timelineId === timelineId) {
        docs.push(JSON.parse(JSON.stringify(doc)));
      }
    }
    return docs;
  }

  public async findAll(): Promise<OrderSummaryDocument[]> {
    const docs = Array.from(this.documents.values()).map((d) => JSON.parse(JSON.stringify(d)));
    return docs.sort((a, b) => a._id.localeCompare(b._id));
  }

  public async clearShadowCollection(): Promise<void> {
    this.shadowDocuments.clear();
  }

  public async insertShadowOrderSummary(doc: OrderSummaryDocument): Promise<void> {
    this.shadowDocuments.set(doc._id, JSON.parse(JSON.stringify(doc)));
  }

  public async findAllShadow(): Promise<OrderSummaryDocument[]> {
    const docs = Array.from(this.shadowDocuments.values()).map((d) =>
      JSON.parse(JSON.stringify(d)),
    );
    return docs.sort((a, b) => a._id.localeCompare(b._id));
  }

  public async swapShadowCollection(): Promise<void> {
    this.documents.clear();
    for (const [key, val] of this.shadowDocuments.entries()) {
      this.documents.set(key, JSON.parse(JSON.stringify(val)));
    }
    this.shadowDocuments.clear();
  }

  public async upsertOrderSummary(
    input: Omit<OrderSummaryDocument, '_id' | 'projectionHash' | 'updatedAt'>,
  ): Promise<ProjectionUpsertResult> {
    const documentId = `${input.timelineId}:${input.aggregateId}`;
    const newSequence = input.appliedSequence;

    const projectionHash = computeProjectionHash(input as unknown as Record<string, unknown>);
    const fullDoc: OrderSummaryDocument = {
      ...input,
      _id: documentId,
      projectionHash,
      updatedAt: new Date(),
    };

    const existing = this.documents.get(documentId);

    // If simulated race condition enabled on first insert
    if (!existing && this.simulateFirstInsertRace) {
      // Simulate another worker inserted concurrently with the same or higher sequence
      this.documents.set(documentId, {
        ...fullDoc,
        appliedSequence: newSequence,
      });
      // Reconcile as DuplicateKeyError
      return {
        status: 'NOOP_ALREADY_APPLIED',
        appliedSequence: newSequence,
        documentId,
      };
    }

    if (!existing) {
      this.documents.set(documentId, fullDoc);
      return {
        status: 'APPLIED',
        appliedSequence: newSequence,
        documentId,
      };
    }

    // Sequence guard: appliedSequence < newSequence (Rule 10)
    if (existing.appliedSequence >= newSequence) {
      return {
        status: 'NOOP_STALE_SEQUENCE',
        appliedSequence: newSequence,
        documentId,
      };
    }

    this.documents.set(documentId, fullDoc);
    return {
      status: 'APPLIED',
      appliedSequence: newSequence,
      documentId,
    };
  }

  public clear(): void {
    this.documents.clear();
    this.shadowDocuments.clear();
  }
}
