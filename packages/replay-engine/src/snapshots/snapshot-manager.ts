import { randomUUID } from 'node:crypto';
import { createLogger } from '@chronoscope/observability';
import type {
  ISnapshotMetadataManager,
  SnapshotRecord,
  SnapshotSetRecord,
} from '@chronoscope/database';
import type { AuthoritativeStateResolver } from '../authoritative-state-resolver.js';
import {
  type ISnapshotStorage,
  type SnapshotPayload,
  type SnapshotSetPayload,
  computePayloadHash,
} from './snapshot-storage.js';

const logger = createLogger({ name: 'snapshot-manager' });

export interface CreateAggregateSnapshotOptions {
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly targetSequence: number;
  readonly aggregateType?: string | undefined;
  readonly setId?: string | null | undefined;
}

export interface CreateTimelineSnapshotSetOptions {
  readonly timelineId: string;
  readonly timelinePosition: number;
  readonly aggregates: readonly {
    aggregateId: string;
    aggregateType: string;
    currentSequence: number;
  }[];
}

/**
 * SnapshotManager — system-guarantees.md Rule 14 & ADR-009:
 * "Snapshots exist at two scopes (per-aggregate snapshots, timeline-level snapshot_sets),
 * metadata in MySQL, payload in MinIO/storage. A snapshot's status only becomes READY
 * after its object and content_hash are verified."
 */
export class SnapshotManager {
  constructor(
    private readonly metadataManager: ISnapshotMetadataManager,
    private readonly storage: ISnapshotStorage,
    private readonly stateResolver: AuthoritativeStateResolver,
  ) {}

  public async createAggregateSnapshot(
    options: CreateAggregateSnapshotOptions,
  ): Promise<SnapshotRecord> {
    const {
      timelineId,
      aggregateId,
      targetSequence,
      aggregateType = 'Order',
      setId = null,
    } = options;

    const snapshotId = randomUUID();
    const location = `snapshots/${timelineId}/${aggregateId}/${targetSequence}.json`;

    logger.info(
      { snapshotId, timelineId, aggregateId, targetSequence },
      'Capturing aggregate snapshot',
    );

    // 1. Resolve authoritative historical state up to targetSequence
    const resolved = await this.stateResolver.resolve(
      timelineId,
      aggregateId,
      targetSequence,
      aggregateType,
    );

    const payload: SnapshotPayload = {
      snapshotId,
      timelineId,
      aggregateId,
      aggregateType,
      aggregateSequence: resolved.aggregateSequence,
      state: resolved.state,
      stateHash: resolved.stateHash,
      capturedAt: new Date().toISOString(),
    };

    // 2. Persist payload to storage and obtain contentHash
    const { contentHash } = await this.storage.writeSnapshotPayload(location, payload);

    // 3. Verify content_hash before marking READY (Rule 14 Invariant)
    const verified = await this.storage.verifyPayloadIntegrity(location, contentHash);
    if (!verified) {
      throw new Error(
        `SNAPSHOT_INTEGRITY_FAILED: Content hash verification failed for snapshot ${snapshotId}`,
      );
    }

    // 4. Record snapshot in metadata store with READY status
    const record: SnapshotRecord = {
      snapshotId,
      setId,
      timelineId,
      aggregateId,
      aggregateType,
      aggregateSequence: resolved.aggregateSequence,
      stateHash: resolved.stateHash,
      status: 'READY',
      storageLocation: location,
      contentHash,
      createdAt: payload.capturedAt,
    };

    await this.metadataManager.insertSnapshot(record);

    logger.info({ snapshotId, contentHash }, 'Aggregate snapshot marked READY');
    return record;
  }

  public async createTimelineSnapshotSet(
    options: CreateTimelineSnapshotSetOptions,
  ): Promise<SnapshotSetRecord> {
    const { timelineId, timelinePosition, aggregates } = options;
    const setId = randomUUID();
    const location = `snapshot-sets/${timelineId}/${timelinePosition}.json`;

    logger.info({ setId, timelineId, timelinePosition }, 'Capturing timeline snapshot set');

    // 1. Register snapshot set in CREATING status
    await this.metadataManager.insertSnapshotSet({
      setId,
      timelineId,
      timelinePosition,
      status: 'CREATING',
      contentHash: null,
      storageLocation: location,
      metadata: { aggregateCount: aggregates.length },
    });

    const individualSnapshots: SnapshotPayload[] = [];

    // 2. Capture snapshot for every aggregate at its consistent-cut sequence
    for (const agg of aggregates) {
      const snap = await this.createAggregateSnapshot({
        timelineId,
        aggregateId: agg.aggregateId,
        targetSequence: agg.currentSequence,
        aggregateType: agg.aggregateType,
        setId,
      });

      const payload = await this.storage.readSnapshotPayload<SnapshotPayload>(snap.storageLocation);
      individualSnapshots.push(payload);
    }

    // 3. Bundle into SnapshotSetPayload
    const setPayload: SnapshotSetPayload = {
      setId,
      timelineId,
      timelinePosition,
      snapshots: individualSnapshots,
      setHash: computePayloadHash(individualSnapshots),
      capturedAt: new Date().toISOString(),
    };

    // 4. Persist set payload and verify integrity
    const { contentHash } = await this.storage.writeSnapshotPayload(location, setPayload);
    const verified = await this.storage.verifyPayloadIntegrity(location, contentHash);
    if (!verified) {
      await this.metadataManager.updateSnapshotSetStatus(setId, 'FAILED');
      throw new Error(
        `SNAPSHOT_SET_INTEGRITY_FAILED: Verification failed for snapshot set ${setId}`,
      );
    }

    // 5. Mark set READY
    await this.metadataManager.updateSnapshotSetStatus(setId, 'READY', contentHash);

    const result = await this.metadataManager.getSnapshotSet(setId);
    if (!result) {
      throw new Error(`Failed to load created snapshot set: ${setId}`);
    }
    return result;
  }

  /**
   * Loads and verifies a snapshot, returning null if missing, unready, or corrupted
   * to enable transparent fallback to raw event history (ADR-009 & Phase 12).
   */
  public async loadAndVerifySnapshot(
    snapshotId: string,
  ): Promise<{ snapshot: SnapshotRecord; payload: SnapshotPayload } | null> {
    try {
      const snapshot = await this.metadataManager.getSnapshot(snapshotId);
      if (!snapshot || snapshot.status !== 'READY') {
        return null;
      }

      const isValid = await this.storage.verifyPayloadIntegrity(
        snapshot.storageLocation,
        snapshot.contentHash,
      );
      if (!isValid) {
        logger.warn(
          { snapshotId, location: snapshot.storageLocation },
          'Snapshot content hash mismatch: falling back to raw events',
        );
        return null;
      }

      const payload = await this.storage.readSnapshotPayload<SnapshotPayload>(
        snapshot.storageLocation,
      );

      // Verify payload's internal state hash matches metadata record
      if (payload.stateHash !== snapshot.stateHash) {
        logger.warn(
          { snapshotId },
          'Snapshot payload state hash does not match metadata: falling back to raw events',
        );
        return null;
      }

      return { snapshot, payload };
    } catch (err) {
      logger.warn(
        { snapshotId, error: (err as Error).message },
        'Error reading snapshot payload: falling back to raw events',
      );
      return null;
    }
  }

  public async getLatestReadySnapshot(
    timelineId: string,
    aggregateId: string,
    maxSequence: number,
  ): Promise<SnapshotRecord | null> {
    return this.metadataManager.getLatestReadySnapshot(timelineId, aggregateId, maxSequence);
  }
}
