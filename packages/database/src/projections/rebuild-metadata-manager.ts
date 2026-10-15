import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';

export type RebuildStatus = 'REBUILDING' | 'VALIDATING' | 'SWAPPING' | 'COMPLETED' | 'FAILED';

export interface RebuildCutoffRecord {
  readonly runId: string;
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly cutoffSequence: number;
}

export interface RebuildRunRecord {
  readonly runId: string;
  readonly projectionName: string;
  readonly status: RebuildStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly sourceManifestHash: string | null;
  readonly projectionCollectionHash: string | null;
  readonly documentsExpected: number | null;
  readonly documentsWritten: number | null;
  readonly errorCode: string | null;
}

export interface TimelineAggregateInfo {
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly currentSequence: number;
}

export interface IRebuildMetadataManager {
  recordCutoffs(
    runId: string,
    cutoffs: Array<{ timelineId: string; aggregateId: string; cutoffSequence: number }>,
  ): Promise<void>;
  getCutoffs(runId: string): Promise<RebuildCutoffRecord[]>;
  createRebuildRun(runId: string, projectionName: string): Promise<void>;
  updateRebuildRun(
    runId: string,
    update: {
      status: RebuildStatus;
      sourceManifestHash?: string;
      projectionCollectionHash?: string;
      documentsExpected?: number;
      documentsWritten?: number;
      errorCode?: string;
    },
  ): Promise<void>;
  getRebuildRun(runId: string): Promise<RebuildRunRecord | null>;
  getAggregatesForTimeline(timelineId: string): Promise<TimelineAggregateInfo[]>;
  setProjectionStatus(projectionName: string, status: string): Promise<void>;
  completeRebuildMetadata(
    projectionName: string,
    sourceManifestHash: string,
    projectionCollectionHash: string,
  ): Promise<void>;
  acquireAdvisoryLock(name: string, timeoutSeconds: number): Promise<boolean>;
  releaseAdvisoryLock(name: string): Promise<boolean>;
}

interface RebuildRunRow extends RowDataPacket {
  run_id: string;
  projection_name: string;
  status: RebuildStatus;
  started_at: string;
  completed_at: string | null;
  source_manifest_hash: string | null;
  projection_collection_hash: string | null;
  documents_expected: number | null;
  documents_written: number | null;
  error_code: string | null;
}

interface RebuildCutoffRow extends RowDataPacket {
  run_id: string;
  timeline_id: string;
  aggregate_id: string;
  cutoff_sequence: number | string;
}

interface TimelineAggregateRow extends RowDataPacket {
  timeline_id: string;
  aggregate_id: string;
  aggregate_type: string;
  current_sequence: number | string;
}

interface AdvisoryLockRow extends RowDataPacket {
  acquired: number | null;
  released: number | null;
}

export class MysqlRebuildMetadataManager implements IRebuildMetadataManager {
  constructor(private readonly pool: Pool) {}

  public async recordCutoffs(
    runId: string,
    cutoffs: Array<{ timelineId: string; aggregateId: string; cutoffSequence: number }>,
  ): Promise<void> {
    for (const cutoff of cutoffs) {
      await this.pool.query(SQL.INSERT_PROJECTION_REBUILD_CUTOFF, [
        runId,
        cutoff.timelineId,
        cutoff.aggregateId,
        cutoff.cutoffSequence,
      ]);
    }
  }

  public async getCutoffs(runId: string): Promise<RebuildCutoffRecord[]> {
    const [rows] = await this.pool.query<RebuildCutoffRow[]>(
      SQL.SELECT_PROJECTION_REBUILD_CUTOFFS_BY_RUN,
      [runId],
    );
    return rows.map((r) => ({
      runId: r.run_id,
      timelineId: r.timeline_id,
      aggregateId: r.aggregate_id,
      cutoffSequence: Number(r.cutoff_sequence),
    }));
  }

  public async createRebuildRun(runId: string, projectionName: string): Promise<void> {
    await this.pool.query(SQL.INSERT_PROJECTION_REBUILD_RUN, [runId, projectionName]);
  }

  public async updateRebuildRun(
    runId: string,
    update: {
      status: RebuildStatus;
      sourceManifestHash?: string;
      projectionCollectionHash?: string;
      documentsExpected?: number;
      documentsWritten?: number;
      errorCode?: string;
    },
  ): Promise<void> {
    await this.pool.query(SQL.UPDATE_PROJECTION_REBUILD_RUN_STATUS, [
      update.status,
      update.status,
      update.sourceManifestHash ?? null,
      update.projectionCollectionHash ?? null,
      update.documentsExpected ?? null,
      update.documentsWritten ?? null,
      update.errorCode ?? null,
      runId,
    ]);
  }

  public async getRebuildRun(runId: string): Promise<RebuildRunRecord | null> {
    const [rows] = await this.pool.query<RebuildRunRow[]>(SQL.SELECT_PROJECTION_REBUILD_RUN, [
      runId,
    ]);
    const r = rows[0];
    if (!r) return null;
    return {
      runId: r.run_id,
      projectionName: r.projection_name,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      sourceManifestHash: r.source_manifest_hash,
      projectionCollectionHash: r.projection_collection_hash,
      documentsExpected: r.documents_expected !== null ? Number(r.documents_expected) : null,
      documentsWritten: r.documents_written !== null ? Number(r.documents_written) : null,
      errorCode: r.error_code,
    };
  }

  public async getAggregatesForTimeline(timelineId: string): Promise<TimelineAggregateInfo[]> {
    const [rows] = await this.pool.query<TimelineAggregateRow[]>(
      SQL.SELECT_ALL_AGGREGATES_FOR_TIMELINE,
      [timelineId],
    );
    return rows.map((r) => ({
      timelineId: r.timeline_id,
      aggregateId: r.aggregate_id,
      aggregateType: r.aggregate_type,
      currentSequence: Number(r.current_sequence),
    }));
  }

  public async setProjectionStatus(projectionName: string, status: string): Promise<void> {
    await this.pool.query(SQL.UPDATE_PROJECTION_STATUS, [status, projectionName]);
  }

  public async completeRebuildMetadata(
    projectionName: string,
    sourceManifestHash: string,
    projectionCollectionHash: string,
  ): Promise<void> {
    await this.pool.query(SQL.UPDATE_PROJECTION_METADATA_REBUILD_COMPLETE, [
      sourceManifestHash,
      projectionCollectionHash,
      projectionName,
    ]);
  }

  public async acquireAdvisoryLock(name: string, timeoutSeconds: number): Promise<boolean> {
    const [rows] = await this.pool.query<AdvisoryLockRow[]>(SQL.GET_ADVISORY_LOCK, [
      name,
      timeoutSeconds,
    ]);
    const acquired = rows[0]?.acquired;
    return acquired === 1;
  }

  public async releaseAdvisoryLock(name: string): Promise<boolean> {
    const [rows] = await this.pool.query<AdvisoryLockRow[]>(SQL.RELEASE_ADVISORY_LOCK, [name]);
    const released = rows[0]?.released;
    return released === 1;
  }
}

export class InMemoryRebuildMetadataManager implements IRebuildMetadataManager {
  private readonly cutoffs = new Map<string, RebuildCutoffRecord[]>();
  private readonly runs = new Map<string, RebuildRunRecord>();
  private readonly statuses = new Map<string, string>();
  private readonly metadataHashes = new Map<
    string,
    { sourceManifestHash: string; projectionCollectionHash: string }
  >();
  private readonly locks = new Set<string>();
  private timelineAggregates = new Map<string, TimelineAggregateInfo[]>();

  public setTimelineAggregates(timelineId: string, aggregates: TimelineAggregateInfo[]): void {
    this.timelineAggregates.set(timelineId, [...aggregates]);
  }

  public async recordCutoffs(
    runId: string,
    cutoffs: Array<{ timelineId: string; aggregateId: string; cutoffSequence: number }>,
  ): Promise<void> {
    const list = this.cutoffs.get(runId) ?? [];
    for (const c of cutoffs) {
      list.push({ runId, ...c });
    }
    this.cutoffs.set(runId, list);
  }

  public async getCutoffs(runId: string): Promise<RebuildCutoffRecord[]> {
    return this.cutoffs.get(runId) ?? [];
  }

  public async createRebuildRun(runId: string, projectionName: string): Promise<void> {
    this.runs.set(runId, {
      runId,
      projectionName,
      status: 'REBUILDING',
      startedAt: new Date().toISOString(),
      completedAt: null,
      sourceManifestHash: null,
      projectionCollectionHash: null,
      documentsExpected: null,
      documentsWritten: null,
      errorCode: null,
    });
  }

  public async updateRebuildRun(
    runId: string,
    update: {
      status: RebuildStatus;
      sourceManifestHash?: string;
      projectionCollectionHash?: string;
      documentsExpected?: number;
      documentsWritten?: number;
      errorCode?: string;
    },
  ): Promise<void> {
    const existing = this.runs.get(runId);
    if (!existing) return;

    this.runs.set(runId, {
      ...existing,
      status: update.status,
      completedAt:
        update.status === 'COMPLETED' || update.status === 'FAILED'
          ? new Date().toISOString()
          : existing.completedAt,
      sourceManifestHash: update.sourceManifestHash ?? existing.sourceManifestHash,
      projectionCollectionHash:
        update.projectionCollectionHash ?? existing.projectionCollectionHash,
      documentsExpected: update.documentsExpected ?? existing.documentsExpected,
      documentsWritten: update.documentsWritten ?? existing.documentsWritten,
      errorCode: update.errorCode ?? existing.errorCode,
    });
  }

  public async getRebuildRun(runId: string): Promise<RebuildRunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  public async getAggregatesForTimeline(timelineId: string): Promise<TimelineAggregateInfo[]> {
    return this.timelineAggregates.get(timelineId) ?? [];
  }

  public async setProjectionStatus(projectionName: string, status: string): Promise<void> {
    this.statuses.set(projectionName, status);
  }

  public async completeRebuildMetadata(
    projectionName: string,
    sourceManifestHash: string,
    projectionCollectionHash: string,
  ): Promise<void> {
    this.statuses.set(projectionName, 'ACTIVE');
    this.metadataHashes.set(projectionName, { sourceManifestHash, projectionCollectionHash });
  }

  public async acquireAdvisoryLock(name: string, _timeoutSeconds: number): Promise<boolean> {
    if (this.locks.has(name)) {
      return false;
    }
    this.locks.add(name);
    return true;
  }

  public async releaseAdvisoryLock(name: string): Promise<boolean> {
    this.locks.delete(name);
    return true;
  }

  public getProjectionStatus(projectionName: string): string {
    return this.statuses.get(projectionName) ?? 'ACTIVE';
  }
}
