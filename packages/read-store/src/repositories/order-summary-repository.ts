import { type Db, type Collection, MongoServerError } from 'mongodb';
import { computeProjectionHash } from '../hash/projection-hash.js';
import type { OrderSummaryDocument, ProjectionUpsertResult } from '../types.js';

export interface IOrderSummaryRepository {
  findById(timelineId: string, aggregateId: string): Promise<OrderSummaryDocument | null>;
  findByTimeline(timelineId: string): Promise<OrderSummaryDocument[]>;
  findAll(): Promise<OrderSummaryDocument[]>;
  upsertOrderSummary(
    doc: Omit<OrderSummaryDocument, '_id' | 'projectionHash' | 'updatedAt'>,
  ): Promise<ProjectionUpsertResult>;
  // Rebuild shadow collection support (system-guarantees.md Rule 10, Phase 5)
  clearShadowCollection(): Promise<void>;
  insertShadowOrderSummary(doc: OrderSummaryDocument): Promise<void>;
  findAllShadow(): Promise<OrderSummaryDocument[]>;
  swapShadowCollection(): Promise<void>;
}

export class MongoOrderSummaryRepository implements IOrderSummaryRepository {
  private readonly targetCollectionName = 'order_summary';
  private readonly shadowCollectionName = 'order_summary__rebuild';
  private readonly collection: Collection<OrderSummaryDocument>;

  constructor(private readonly db: Db) {
    this.collection = this.db.collection<OrderSummaryDocument>(this.targetCollectionName);
  }

  public async findById(
    timelineId: string,
    aggregateId: string,
  ): Promise<OrderSummaryDocument | null> {
    const documentId = `${timelineId}:${aggregateId}`;
    return this.collection.findOne({ _id: documentId });
  }

  public async findByTimeline(timelineId: string): Promise<OrderSummaryDocument[]> {
    return this.collection.find({ timelineId }).toArray();
  }

  public async findAll(): Promise<OrderSummaryDocument[]> {
    return this.collection.find().sort({ _id: 1 }).toArray();
  }

  public async clearShadowCollection(): Promise<void> {
    await this.db.collection(this.shadowCollectionName).deleteMany({});
  }

  public async insertShadowOrderSummary(doc: OrderSummaryDocument): Promise<void> {
    await this.db
      .collection<OrderSummaryDocument>(this.shadowCollectionName)
      .insertOne(doc as never);
  }

  public async findAllShadow(): Promise<OrderSummaryDocument[]> {
    return this.db
      .collection<OrderSummaryDocument>(this.shadowCollectionName)
      .find()
      .sort({ _id: 1 })
      .toArray();
  }

  /**
   * Performs shadow collection rename swap — system-guarantees.md Phase 5:
   * db.order_summary__rebuild.renameCollection('order_summary', {dropTarget: true})
   *
   * Note: Not equivalent to MySQL's atomic multi-table RENAME TABLE: MongoDB drops
   * the target first and holds exclusive collection locks during the swap.
   */
  public async swapShadowCollection(): Promise<void> {
    const shadowCol = this.db.collection(this.shadowCollectionName);
    await shadowCol.rename(this.targetCollectionName, { dropTarget: true });
  }

  /**
   * Sequence-guarded, idempotent MongoDB upsert (Rule 10).
   *
   * Keyed strictly by composite `${timelineId}:${aggregateId}`, NEVER aggregateId alone.
   * Write concern: w:1, j:true (journal-acknowledged).
   *
   * Concurrent-first-insert race defense:
   * If two workers race the first-ever write for this document ID, MongoDB raises DuplicateKeyError (11000).
   * The repository catches this, re-reads the stored document, and reconciles:
   *   - If stored.appliedSequence >= newSequence: returns NOOP_ALREADY_APPLIED
   *   - If stored.appliedSequence < newSequence: reapplies the guarded update without upsert
   */
  public async upsertOrderSummary(
    input: Omit<OrderSummaryDocument, '_id' | 'projectionHash' | 'updatedAt'>,
  ): Promise<ProjectionUpsertResult> {
    const documentId = `${input.timelineId}:${input.aggregateId}`;
    const newSequence = input.appliedSequence;

    // Compute canonical projection content hash excluding transport/audit metadata (Rule 11)
    const projectionHash = computeProjectionHash(input as unknown as Record<string, unknown>);
    const updatedAt = new Date();

    const fullDoc: OrderSummaryDocument = {
      ...input,
      _id: documentId,
      projectionHash,
      updatedAt,
    };

    try {
      const result = await this.collection.updateOne(
        {
          _id: documentId,
          appliedSequence: { $lt: newSequence },
        },
        {
          $set: fullDoc,
        },
        {
          upsert: true,
          writeConcern: { w: 1, j: true },
        },
      );

      if (result.upsertedCount > 0 || result.modifiedCount > 0) {
        return {
          status: 'APPLIED',
          appliedSequence: newSequence,
          documentId,
        };
      }

      // No document was upserted or modified -> stored sequence is already >= newSequence
      return {
        status: 'NOOP_STALE_SEQUENCE',
        appliedSequence: newSequence,
        documentId,
      };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        // Concurrent first-insert race (DuplicateKeyError on _id)
        return this.reconcileConcurrentFirstInsert(documentId, fullDoc);
      }
      throw error;
    }
  }

  private async reconcileConcurrentFirstInsert(
    documentId: string,
    doc: OrderSummaryDocument,
  ): Promise<ProjectionUpsertResult> {
    const existing = await this.collection.findOne({ _id: documentId });

    if (existing && existing.appliedSequence >= doc.appliedSequence) {
      return {
        status: 'NOOP_ALREADY_APPLIED',
        appliedSequence: doc.appliedSequence,
        documentId,
      };
    }

    // Existing has lower sequence; retry update without upsert
    const retryResult = await this.collection.updateOne(
      {
        _id: documentId,
        appliedSequence: { $lt: doc.appliedSequence },
      },
      {
        $set: doc,
      },
      {
        writeConcern: { w: 1, j: true },
      },
    );

    if (retryResult.modifiedCount > 0) {
      return {
        status: 'APPLIED',
        appliedSequence: doc.appliedSequence,
        documentId,
      };
    }

    return {
      status: 'NOOP_STALE_SEQUENCE',
      appliedSequence: doc.appliedSequence,
      documentId,
    };
  }
}
