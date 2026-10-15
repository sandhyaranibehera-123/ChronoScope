import { createHash } from 'node:crypto';

/**
 * Deterministic Hashing & Canonical JSON — system-guarantees.md rule 9 & 11:
 * "Replay is deterministic: canonical JSON, canonical numeric representation,
 * canonical CHAR(64) hash encoding used consistently for every *_hash field...
 * State/event hashing excludes event/transport identity (event_id, trace_id,
 * span_id, request_id, command_id, recorded_at)."
 */

const EXCLUDED_HASH_FIELDS = new Set([
  'event_id',
  'trace_id',
  'span_id',
  'request_id',
  'command_id',
  'recorded_at',
  'execution_id',
  'appliedKafkaTopic',
  'appliedKafkaPartition',
  'appliedKafkaOffset',
  'appliedEventId',
]);

/**
 * Deterministic JSON stringification with sorted keys, bigint conversion,
 * and stable representation.
 */
export function canonicalJson(value: unknown, excludeTransportMetadata = false): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot canonically serialize non-finite number: ${value}`);
    }
    return Object.is(value, -0) ? '0' : value.toString();
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalJson(item, excludeTransportMetadata));
    return `[${items.join(',')}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];

    for (const key of keys) {
      if (excludeTransportMetadata && EXCLUDED_HASH_FIELDS.has(key)) {
        continue;
      }
      const val = obj[key];
      if (val === undefined) {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${canonicalJson(val, excludeTransportMetadata)}`);
    }

    return `{${entries.join(',')}}`;
  }

  throw new Error(`Unsupported value type in canonicalJson: ${typeof value}`);
}

/**
 * Computes a canonical SHA-256 hash (64 hex characters).
 */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Computes state hash for aggregate state (Rule 9).
 * Always excludes transient / transport metadata.
 */
export function computeStateHash(state: unknown): string {
  const canonical = canonicalJson(state, true);
  return sha256Hex(canonical);
}

/**
 * Computes event hash for a domain event payload (Rule 11).
 * Excludes transport metadata.
 */
export function computeEventHash(payload: unknown): string {
  const canonical = canonicalJson(payload, true);
  return sha256Hex(canonical);
}
