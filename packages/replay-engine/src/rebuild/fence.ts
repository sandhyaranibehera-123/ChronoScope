import { createHash } from 'node:crypto';

/**
 * Deterministic MySQL advisory lock names for Projections (Rules 11, 17, Phase 5).
 * Bounded length <= 64 characters.
 */

export function getProjectionPartitionFenceName(projectionName: string, partition: number): string {
  const hash = createHash('sha256').update(projectionName).digest('hex').slice(0, 16);
  return `chronoscope:proj:${hash}:p${partition}`;
}

export function getProjectionRebuildControllerLockName(projectionName: string): string {
  const hash = createHash('sha256').update(projectionName).digest('hex').slice(0, 16);
  return `chronoscope:proj:${hash}:controller`;
}
