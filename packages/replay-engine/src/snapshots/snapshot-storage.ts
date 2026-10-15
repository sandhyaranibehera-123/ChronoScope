import { createHash } from 'node:crypto';
import { canonicalJson } from '@chronoscope/domain';

export interface SnapshotPayload<T = unknown> {
  readonly snapshotId: string;
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly aggregateSequence: number;
  readonly state: T;
  readonly stateHash: string;
  readonly capturedAt: string;
}

export interface SnapshotSetPayload {
  readonly setId: string;
  readonly timelineId: string;
  readonly timelinePosition: number;
  readonly snapshots: readonly SnapshotPayload[];
  readonly setHash: string;
  readonly capturedAt: string;
}

/**
 * Computes canonical SHA-256 hash of a snapshot payload object.
 */
export function computePayloadHash(payload: unknown): string {
  const json = canonicalJson(payload);
  return createHash('sha256').update(json).digest('hex');
}

export interface ISnapshotStorage {
  writeSnapshotPayload(
    location: string,
    payload: unknown,
  ): Promise<{ contentHash: string; byteSize: number }>;
  readSnapshotPayload<T = unknown>(location: string): Promise<T>;
  deleteSnapshotPayload(location: string): Promise<void>;
  verifyPayloadIntegrity(location: string, expectedHash: string): Promise<boolean>;
}

/**
 * In-memory snapshot storage for hermetic, infra-free test execution (Rule 24).
 */
export class InMemorySnapshotStorage implements ISnapshotStorage {
  private readonly storage = new Map<string, { payloadString: string; contentHash: string }>();

  public async writeSnapshotPayload(
    location: string,
    payload: unknown,
  ): Promise<{ contentHash: string; byteSize: number }> {
    const json = canonicalJson(payload);
    const contentHash = createHash('sha256').update(json).digest('hex');
    this.storage.set(location, { payloadString: json, contentHash });
    return {
      contentHash,
      byteSize: Buffer.byteLength(json, 'utf-8'),
    };
  }

  public async readSnapshotPayload<T = unknown>(location: string): Promise<T> {
    const item = this.storage.get(location);
    if (!item) {
      throw new Error(`Snapshot payload not found at location: ${location}`);
    }
    return JSON.parse(item.payloadString) as T;
  }

  public async deleteSnapshotPayload(location: string): Promise<void> {
    this.storage.delete(location);
  }

  public async verifyPayloadIntegrity(location: string, expectedHash: string): Promise<boolean> {
    const item = this.storage.get(location);
    if (!item) return false;
    return item.contentHash === expectedHash;
  }

  // Testing helper: deliberately corrupt payload in storage to test fallback
  public corruptPayload(location: string): void {
    const item = this.storage.get(location);
    if (item) {
      this.storage.set(location, {
        payloadString: item.payloadString + '/* corrupted */',
        contentHash: 'deliberately-invalid-hash',
      });
    }
  }
}
