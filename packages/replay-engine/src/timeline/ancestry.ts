export interface TimelineAncestryNode {
  readonly timelineId: string;
  readonly parentTimelineId: string | null;
  readonly forkPosition: number;
  readonly depth: number;
}

export interface CommonAncestorResult {
  readonly commonAncestorTimelineId: string;
  readonly forkPositionA: number;
  readonly forkPositionB: number;
  readonly depthA: number;
  readonly depthB: number;
}

/**
 * Finds the nearest common ancestor between two timeline ancestry hierarchies.
 * Ancestries are expected to be ordered from leaf (depth 0) to root.
 */
export function findCommonAncestor(
  ancestryA: readonly TimelineAncestryNode[],
  ancestryB: readonly TimelineAncestryNode[],
): CommonAncestorResult | null {
  const mapB = new Map<string, { node: TimelineAncestryNode; index: number }>();
  for (let i = 0; i < ancestryB.length; i++) {
    mapB.set(ancestryB[i]!.timelineId, { node: ancestryB[i]!, index: i });
  }

  for (let idxA = 0; idxA < ancestryA.length; idxA++) {
    const nodeA = ancestryA[idxA]!;
    const matchB = mapB.get(nodeA.timelineId);
    if (matchB) {
      const idxB = matchB.index;

      // The fork position where each branch split from the common ancestor
      const forkPositionA = idxA > 0 ? ancestryA[idxA - 1]!.forkPosition : nodeA.forkPosition;
      const forkPositionB = idxB > 0 ? ancestryB[idxB - 1]!.forkPosition : matchB.node.forkPosition;

      return {
        commonAncestorTimelineId: nodeA.timelineId,
        forkPositionA,
        forkPositionB,
        depthA: nodeA.depth,
        depthB: matchB.node.depth,
      };
    }
  }

  return null;
}
