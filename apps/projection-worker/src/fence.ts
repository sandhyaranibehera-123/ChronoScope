import { createHash } from 'node:crypto';

/**
 * Generates a bounded, deterministic MySQL advisory lock name for Rule 17.
 *
 * MySQL GET_LOCK() lock names are strictly capped at 64 characters.
 * Using a 16-character SHA-256 slice guarantees bounded length regardless
 * of projection name length.
 *
 * Pattern: `chronoscope:proj:${hash}:p${partition}`
 * Example: `chronoscope:proj:a1b2c3d4e5f67890:p3` (total length: 36 chars <= 64)
 */
export function getProjectionPartitionFenceName(projectionName: string, partition: number): string {
  const hash = createHash('sha256').update(projectionName).digest('hex').slice(0, 16);
  return `chronoscope:proj:${hash}:p${partition}`;
}
