import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';

export type SnapshotStatus = 'CREATING' | 'READY' | 'FAILED';

export interface SnapshotRecord {
  readonly snapshotId: string;
  readonly setId: string | null;
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateSequence: number;
  readonly stateHash: string;
  readonly status: SnapshotStatus;
  readonly storageLocation: string;
  readonly contentHash: string;
  readonly createdAt?: string | undefined;
}

export interface SnapshotSetRecord {
  readonly setId: string;
  readonly timelineId: string;
  readonly timelinePosition: number;
  readonly status: SnapshotStatus;
  readonly contentHash: string | null;
  readonly storageLocation: string | null;
  readonly metadata?: unknown | null | undefined;
  readonly createdAt?: string | undefined;
  readonly completedAt?: string | null | undefined;
}

export interface ISnapshotMetadataManager {
  insertSnapshot(snapshot: SnapshotRecord): Promise<void>;
  updateSnapshotStatus(
    snapshotId: string,
    status: SnapshotStatus,
    contentHash?: string,
  ): Promise<void>;
  getSnapshot(snapshotId: string): Promise<SnapshotRecord | null>;
  getLatestReadySnapshot(
    timelineId: string,
    aggregateId: string,
    maxSequence: number,
  ): Promise<SnapshotRecord | null>;
  insertSnapshotSet(set: Omit<SnapshotSetRecord, 'completedAt'>): Promise<void>;
  updateSnapshotSetStatus(
    setId: string,
    status: SnapshotStatus,
    contentHash?: string,
  ): Promise<void>;
  getSnapshotSet(setId: string): Promise<SnapshotSetRecord | null>;
  getSnapshotsForSet(setId: string): Promise<SnapshotRecord[]>;
}

interface SnapshotRow extends RowDataPacket {
  snapshot_id: string;
  set_id: string | null;
  timeline_id: string;
  aggregate_id: string;
  aggregate_type: string;
  aggregate_sequence: number | string;
  state_hash: string;
  status: SnapshotStatus;
  storage_location: string;
  content_hash: string;
  created_at: string;
}

interface SnapshotSetRow extends RowDataPacket {
  set_id: string;
  timeline_id: string;
  timeline_position: number | string;
  status: SnapshotStatus;
  content_hash: string | null;
  storage_location: string | null;
  metadata: unknown;
  created_at: string;
  completed_at: string | null;
}

export class MysqlSnapshotMetadataManager implements ISnapshotMetadataManager {
  constructor(private readonly pool: Pool) {}

  public async insertSnapshot(snapshot: SnapshotRecord): Promise<void> {
    await this.pool.query(SQL.INSERT_SNAPSHOT, [
      snapshot.snapshotId,
      snapshot.setId ?? null,
      snapshot.timelineId,
      snapshot.aggregateId,
      snapshot.aggregateType,
      snapshot.aggregateSequence,
      snapshot.stateHash,
      snapshot.status,
      snapshot.storageLocation,
      snapshot.contentHash,
    ]);
  }

  public async updateSnapshotStatus(
    snapshotId: string,
    status: SnapshotStatus,
    contentHash?: string,
  ): Promise<void> {
    await this.pool.query(SQL.UPDATE_SNAPSHOT_STATUS, [status, contentHash ?? null, snapshotId]);
  }

  public async getSnapshot(snapshotId: string): Promise<SnapshotRecord | null> {
    const [rows] = await this.pool.query<SnapshotRow[]>(SQL.SELECT_SNAPSHOT_BY_ID, [snapshotId]);
    const r = rows[0];
    if (!r) return null;
    return this.mapSnapshotRow(r);
  }

  public async getLatestReadySnapshot(
    timelineId: string,
    aggregateId: string,
    maxSequence: number,
  ): Promise<SnapshotRecord | null> {
    const [rows] = await this.pool.query<SnapshotRow[]>(SQL.SELECT_LATEST_READY_SNAPSHOT, [
      timelineId,
      aggregateId,
      maxSequence,
    ]);
    const r = rows[0];
    if (!r) return null;
    return this.mapSnapshotRow(r);
  }

  public async insertSnapshotSet(set: Omit<SnapshotSetRecord, 'completedAt'>): Promise<void> {
    await this.pool.query(SQL.INSERT_SNAPSHOT_SET, [
      set.setId,
      set.timelineId,
      set.timelinePosition,
      set.storageLocation ?? null,
      set.metadata ? JSON.stringify(set.metadata) : null,
    ]);
  }

  public async updateSnapshotSetStatus(
    setId: string,
    status: SnapshotStatus,
    contentHash?: string,
  ): Promise<void> {
    await this.pool.query(SQL.UPDATE_SNAPSHOT_SET_STATUS, [
      status,
      contentHash ?? null,
      status,
      setId,
    ]);
  }

  public async getSnapshotSet(setId: string): Promise<SnapshotSetRecord | null> {
    const [rows] = await this.pool.query<SnapshotSetRow[]>(SQL.SELECT_SNAPSHOT_SET_BY_ID, [setId]);
    const r = rows[0];
    if (!r) return null;
    return {
      setId: r.set_id,
      timelineId: r.timeline_id,
      timelinePosition: Number(r.timeline_position),
      status: r.status,
      contentHash: r.content_hash,
      storageLocation: r.storage_location,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    };
  }

  public async getSnapshotsForSet(setId: string): Promise<SnapshotRecord[]> {
    const [rows] = await this.pool.query<SnapshotRow[]>(SQL.SELECT_SNAPSHOTS_BY_SET_ID, [setId]);
    return rows.map((r) => this.mapSnapshotRow(r));
  }

  private mapSnapshotRow(r: SnapshotRow): SnapshotRecord {
    return {
      snapshotId: r.snapshot_id,
      setId: r.set_id,
      timelineId: r.timeline_id,
      aggregateId: r.aggregate_id,
      aggregateType: r.aggregate_type,
      aggregateSequence: Number(r.aggregate_sequence),
      stateHash: r.state_hash,
      status: r.status,
      storageLocation: r.storage_location,
      contentHash: r.content_hash,
      createdAt: r.created_at,
    };
  }
}

export class InMemorySnapshotMetadataManager implements ISnapshotMetadataManager {
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private readonly snapshotSets = new Map<string, SnapshotSetRecord>();

  public async insertSnapshot(snapshot: SnapshotRecord): Promise<void> {
    this.snapshots.set(snapshot.snapshotId, {
      ...snapshot,
      createdAt: snapshot.createdAt ?? new Date().toISOString(),
    });
  }

  public async updateSnapshotStatus(
    snapshotId: string,
    status: SnapshotStatus,
    contentHash?: string,
  ): Promise<void> {
    const existing = this.snapshots.get(snapshotId);
    if (!existing) return;
    this.snapshots.set(snapshotId, {
      ...existing,
      status,
      contentHash: contentHash ?? existing.contentHash,
    });
  }

  public async getSnapshot(snapshotId: string): Promise<SnapshotRecord | null> {
    return this.snapshots.get(snapshotId) ?? null;
  }

  public async getLatestReadySnapshot(
    timelineId: string,
    aggregateId: string,
    maxSequence: number,
  ): Promise<SnapshotRecord | null> {
    const matching = Array.from(this.snapshots.values())
      .filter(
        (s) =>
          s.timelineId === timelineId &&
          s.aggregateId === aggregateId &&
          s.status === 'READY' &&
          s.aggregateSequence <= maxSequence,
      )
      .sort((a, b) => b.aggregateSequence - a.aggregateSequence);

    return matching[0] ?? null;
  }

  public async insertSnapshotSet(set: Omit<SnapshotSetRecord, 'completedAt'>): Promise<void> {
    this.snapshotSets.set(set.setId, {
      ...set,
      createdAt: set.createdAt ?? new Date().toISOString(),
      completedAt: null,
    });
  }

  public async updateSnapshotSetStatus(
    setId: string,
    status: SnapshotStatus,
    contentHash?: string,
  ): Promise<void> {
    const existing = this.snapshotSets.get(setId);
    if (!existing) return;
    this.snapshotSets.set(setId, {
      ...existing,
      status,
      contentHash: contentHash ?? existing.contentHash,
      completedAt: status === 'READY' || status === 'FAILED' ? new Date().toISOString() : null,
    });
  }

  public async getSnapshotSet(setId: string): Promise<SnapshotSetRecord | null> {
    return this.snapshotSets.get(setId) ?? null;
  }

  public async getSnapshotsForSet(setId: string): Promise<SnapshotRecord[]> {
    return Array.from(this.snapshots.values()).filter((s) => s.setId === setId);
  }
}
