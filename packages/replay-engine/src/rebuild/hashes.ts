import { canonicalJson, sha256Hex } from '@chronoscope/domain';
import { computeProjectionHash } from '@chronoscope/read-store';

export interface SourceManifestEntry {
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly sourceAggregateSequence: number;
  readonly sourceStateHash: string;
}

export interface ProjectionDocumentLike {
  readonly _id: string;
  readonly projectionHash?: string;
}

/**
 * Computes the collection-level source_manifest_hash — Rule 11:
 * "hash of the sorted {timelineId, aggregateId, sourceAggregateSequence, sourceStateHash}
 * manifest across every aggregate the last successful rebuild included"
 */
export function computeSourceManifestHash(entries: ReadonlyArray<SourceManifestEntry>): string {
  // Sort deterministically by timelineId ASC, then aggregateId ASC
  const sorted = [...entries].sort((a, b) => {
    const cmp = a.timelineId.localeCompare(b.timelineId);
    if (cmp !== 0) return cmp;
    return a.aggregateId.localeCompare(b.aggregateId);
  });

  const canonical = canonicalJson(sorted);
  return sha256Hex(canonical);
}

/**
 * Computes the collection-level projection_collection_hash — Rule 11:
 * "hash of every document's own content (sorted by _id) AS WRITTEN by that same rebuild, at its completion"
 */
export function computeProjectionCollectionHash(
  documents: ReadonlyArray<ProjectionDocumentLike>,
): string {
  // Sort deterministically by _id ASC
  const sorted = [...documents].sort((a, b) => a._id.localeCompare(b._id));

  // Extract each document's canonical projectionHash (or compute it if missing)
  const items = sorted.map((doc) => ({
    _id: doc._id,
    projectionHash:
      doc.projectionHash ?? computeProjectionHash(doc as unknown as Record<string, unknown>),
  }));

  const canonical = canonicalJson(items);
  return sha256Hex(canonical);
}
