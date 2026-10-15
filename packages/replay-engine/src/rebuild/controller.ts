import { randomUUID } from 'node:crypto';
import { createLogger } from '@chronoscope/observability';
import type { OrderState } from '@chronoscope/domain';
import type { IRebuildMetadataManager, TimelineAggregateInfo } from '@chronoscope/database';
import {
  type IOrderSummaryRepository,
  type OrderSummaryDocument,
  computeProjectionHash,
} from '@chronoscope/read-store';
import type { AuthoritativeStateResolver } from '../authoritative-state-resolver.js';
import {
  computeProjectionCollectionHash,
  computeSourceManifestHash,
  type SourceManifestEntry,
} from './hashes.js';
import {
  getProjectionPartitionFenceName,
  getProjectionRebuildControllerLockName,
} from './fence.js';
import type { RebuildProjectionOptions, RebuildProjectionResult } from './types.js';

const logger = createLogger({ name: 'projection-rebuild-controller' });

/**
 * Projection Rebuild Controller — system-guarantees.md Rule 11, 17 & Phase 5.
 *
 * Implements the deterministic 6-step MongoDB rebuild flow using fixed shadow
 * collection (`order_summary__rebuild`) and `renameCollection({ dropTarget: true })`.
 */
export class ProjectionRebuildController {
  constructor(
    private readonly metadataManager: IRebuildMetadataManager,
    private readonly orderSummaryRepo: IOrderSummaryRepository,
    private readonly stateResolver: AuthoritativeStateResolver,
  ) {}

  public async rebuildProjection(
    options: RebuildProjectionOptions,
  ): Promise<RebuildProjectionResult> {
    const startTime = Date.now();
    const {
      projectionName,
      timelineId = '00000000-0000-0000-0000-000000000001',
      partitionCount = 4,
      lockTimeoutSeconds = 5,
    } = options;

    const controllerLockName = getProjectionRebuildControllerLockName(projectionName);

    // Step 1: Acquire projection-level rebuild controller lock (Rule 17)
    const acquiredControllerLock = await this.metadataManager.acquireAdvisoryLock(
      controllerLockName,
      lockTimeoutSeconds,
    );

    if (!acquiredControllerLock) {
      throw new Error(
        `REBUILD_IN_PROGRESS: A projection rebuild is already in flight for '${projectionName}'`,
      );
    }

    const runId = randomUUID();
    const heldFences: string[] = [];

    try {
      logger.info({ runId, projectionName }, 'Starting projection rebuild run');

      // Create rebuild run entry
      await this.metadataManager.createRebuildRun(runId, projectionName);

      // Record cutoff watermark per aggregate at this exact instant (Rule 11 & Phase 5)
      const aggregates: TimelineAggregateInfo[] =
        await this.metadataManager.getAggregatesForTimeline(timelineId);
      const cutoffs = aggregates.map((agg: TimelineAggregateInfo) => ({
        timelineId: agg.timelineId,
        aggregateId: agg.aggregateId,
        cutoffSequence: agg.currentSequence,
      }));

      await this.metadataManager.recordCutoffs(runId, cutoffs);

      // Acquire every partition fence for this projection in deterministic ascending order (p0, p1, ...)
      for (let p = 0; p < partitionCount; p++) {
        const fenceName = getProjectionPartitionFenceName(projectionName, p);
        const acquired = await this.metadataManager.acquireAdvisoryLock(
          fenceName,
          lockTimeoutSeconds,
        );
        if (!acquired) {
          throw new Error(
            `Failed to acquire partition fence '${fenceName}' during rebuild transition`,
          );
        }
        heldFences.push(fenceName);
      }

      // Mark projection_metadata.status = 'REBUILDING' to gate live workers
      await this.metadataManager.setProjectionStatus(projectionName, 'REBUILDING');

      // Release partition fences so workers can observe REBUILDING and safely pause
      for (const fence of heldFences) {
        await this.metadataManager.releaseAdvisoryLock(fence);
      }
      heldFences.length = 0;

      // Step 3: Truncate / recreate fixed shadow collection
      await this.orderSummaryRepo.clearShadowCollection();

      // Replay MySQL events up to cutoff_sequence for each aggregate via AuthoritativeStateResolver
      const manifestEntries: SourceManifestEntry[] = [];
      const writtenDocs: OrderSummaryDocument[] = [];

      for (const agg of aggregates) {
        const resolved = await this.stateResolver.resolve<OrderState>(
          agg.timelineId,
          agg.aggregateId,
          agg.currentSequence,
          agg.aggregateType || 'Order',
        );

        if (!resolved.state) {
          continue;
        }

        const orderState = resolved.state;
        const docId = `${agg.timelineId}:${agg.aggregateId}`;

        const baseDoc = {
          _id: docId,
          timelineId: agg.timelineId,
          aggregateId: agg.aggregateId,
          status: orderState.status,
          items: orderState.items.map((it) => ({
            sku: it.sku,
            quantity: it.quantity,
            amountMinor: Number(it.totalAmountMinor),
          })),
          totalAmountMinor: Number(orderState.total_amount_minor),
          currency: orderState.currency,
          appliedSequence: resolved.aggregateSequence,
          appliedTimelinePosition: 0,
          appliedKafkaTopic: 'chronoscope.rebuild',
          appliedKafkaPartition: 0,
          appliedKafkaOffset: 0,
          appliedEventId: 'rebuild',
          sourceAggregateSequence: resolved.aggregateSequence,
          sourceStateHash: resolved.stateHash,
        };

        const projectionHash = computeProjectionHash(baseDoc as unknown as Record<string, unknown>);
        const fullDoc: OrderSummaryDocument = {
          ...baseDoc,
          projectionHash,
          updatedAt: new Date(),
        };

        await this.orderSummaryRepo.insertShadowOrderSummary(fullDoc);
        writtenDocs.push(fullDoc);

        manifestEntries.push({
          timelineId: agg.timelineId,
          aggregateId: agg.aggregateId,
          sourceAggregateSequence: resolved.aggregateSequence,
          sourceStateHash: resolved.stateHash,
        });
      }

      // Step 4: Validate collection-level hashes
      const sourceManifestHash = computeSourceManifestHash(manifestEntries);
      const projectionCollectionHash = computeProjectionCollectionHash(writtenDocs);

      await this.metadataManager.updateRebuildRun(runId, {
        status: 'VALIDATING',
        sourceManifestHash,
        projectionCollectionHash,
        documentsExpected: aggregates.length,
        documentsWritten: writtenDocs.length,
      });

      // Independent fresh verification against shadow collection
      const shadowDocs = await this.orderSummaryRepo.findAllShadow();
      const freshShadowHash = computeProjectionCollectionHash(shadowDocs);

      if (freshShadowHash !== projectionCollectionHash) {
        throw new Error(
          `Collection hash mismatch: expected ${projectionCollectionHash}, got fresh shadow hash ${freshShadowHash}`,
        );
      }

      // Step 5: Swap shadow collection to target collection (renameCollection with dropTarget: true)
      await this.metadataManager.updateRebuildRun(runId, { status: 'SWAPPING' });
      await this.orderSummaryRepo.swapShadowCollection();

      // Step 6: Re-acquire all partition fences in ascending order
      for (let p = 0; p < partitionCount; p++) {
        const fenceName = getProjectionPartitionFenceName(projectionName, p);
        const acquired = await this.metadataManager.acquireAdvisoryLock(
          fenceName,
          lockTimeoutSeconds,
        );
        if (!acquired) {
          throw new Error(
            `Failed to acquire partition fence '${fenceName}' during completion transition`,
          );
        }
        heldFences.push(fenceName);
      }

      // Mark projection_rebuild_runs.status = COMPLETED and projection_metadata.status = ACTIVE
      await this.metadataManager.updateRebuildRun(runId, {
        status: 'COMPLETED',
        sourceManifestHash,
        projectionCollectionHash,
        documentsExpected: aggregates.length,
        documentsWritten: writtenDocs.length,
      });

      await this.metadataManager.completeRebuildMetadata(
        projectionName,
        sourceManifestHash,
        projectionCollectionHash,
      );

      // Release partition fences
      for (const fence of heldFences) {
        await this.metadataManager.releaseAdvisoryLock(fence);
      }
      heldFences.length = 0;

      logger.info(
        { runId, projectionName, documentsWritten: writtenDocs.length },
        'Projection rebuild completed successfully',
      );

      return {
        success: true,
        runId,
        projectionName,
        documentsWritten: writtenDocs.length,
        sourceManifestHash,
        projectionCollectionHash,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const err = error as Error;
      logger.error({ runId, error: err.message }, 'Projection rebuild failed');

      // Attempt to mark run as failed in database
      try {
        await this.metadataManager.updateRebuildRun(runId, {
          status: 'FAILED',
          errorCode: err.message.slice(0, 64),
        });
      } catch {
        // Suppress secondary error
      }

      throw error;
    } finally {
      // Ensure any lingering partition fences are released
      for (const fence of heldFences) {
        await this.metadataManager.releaseAdvisoryLock(fence).catch(() => {});
      }
      // Release rebuild controller lock
      await this.metadataManager.releaseAdvisoryLock(controllerLockName).catch(() => {});
    }
  }
}
