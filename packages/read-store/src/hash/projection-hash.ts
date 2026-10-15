import { createHash } from 'node:crypto';

/**
 * Deterministic JSON stringifier with recursively sorted object keys.
 */
function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalStringify(item)).join(',')}]`;
  }

  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify((obj as Record<string, unknown>)[key])}`,
  );
  return `{${pairs.join(',')}}`;
}

const EXCLUDED_BOOKKEEPING_FIELDS = new Set([
  '_id',
  'appliedSequence',
  'appliedTimelinePosition',
  'appliedKafkaTopic',
  'appliedKafkaPartition',
  'appliedKafkaOffset',
  'appliedEventId',
  'sourceAggregateSequence',
  'sourceStateHash',
  'projectionHash',
  'updatedAt',
]);

/**
 * Computes canonical SHA-256 projectionHash for a MongoDB document per Rule 11.
 * Excludes transport and audit bookkeeping fields so that it validates the determinism
 * of the projection content alone.
 */
export function computeProjectionHash(doc: Record<string, unknown>): string {
  const contentOnly: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(doc)) {
    if (!EXCLUDED_BOOKKEEPING_FIELDS.has(key)) {
      contentOnly[key] = value;
    }
  }

  const canonicalJson = canonicalStringify(contentOnly);
  return createHash('sha256').update(canonicalJson, 'utf-8').digest('hex');
}
