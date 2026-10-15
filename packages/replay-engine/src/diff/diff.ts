import { type DomainEvent, canonicalJson } from '@chronoscope/domain';
import type { ScenarioInputRecord } from '@chronoscope/database';
import { findCommonAncestor, type TimelineAncestryNode } from '../timeline/ancestry.js';

export interface TimelineDiffInput {
  readonly timelineIdA: string;
  readonly timelineIdB: string;
  readonly aggregateId?: string | undefined;
}

export interface StateProvider {
  getState(
    timelineId: string,
    aggregateId: string,
  ): Promise<{ state: unknown; stateHash: string } | null>;
  getAncestry(timelineId: string): Promise<readonly TimelineAncestryNode[]>;
  getEffectiveEvents(timelineId: string, aggregateId?: string): Promise<readonly DomainEvent[]>;
  getScenarioInputs(timelineId: string): Promise<readonly ScenarioInputRecord[]>;
}

export interface StateDiff {
  readonly status?: { readonly from: unknown; readonly to: unknown } | undefined;
  readonly fieldsChanged?:
    Record<string, { readonly from: unknown; readonly to: unknown }> | undefined;
  readonly divergenceReason?: string | undefined;
}

export interface TimelineDiffResult {
  readonly timelineIdA: string;
  readonly timelineIdB: string;
  readonly commonAncestorTimelineId: string | null;
  readonly forkPosition: number;
  readonly aggregateId: string | null;
  readonly stateHashA: string | null;
  readonly stateHashB: string | null;
  readonly hashesMatch: boolean;
  readonly stateA: unknown | null;
  readonly stateB: unknown | null;
  readonly stateDiff: StateDiff;
  readonly divergingEventsA: readonly DomainEvent[];
  readonly divergingEventsB: readonly DomainEvent[];
  readonly scenarioInputs: readonly ScenarioInputRecord[];
}

/**
 * Timeline Diff Engine (Phase 7).
 *
 * Contrasts execution state between two timelines (e.g. MAIN vs COUNTERFACTUAL BRANCH):
 * 1. Pinpoints common ancestor and fork position.
 * 2. Compares live state hashes and attributes.
 * 3. Identifies diverging event streams post-fork.
 * 4. Explains divergence causally through scenario inputs.
 */
export class TimelineDiffEngine {
  constructor(private readonly provider: StateProvider) {}

  public async diff(input: TimelineDiffInput): Promise<TimelineDiffResult> {
    const [ancestryA, ancestryB] = await Promise.all([
      this.provider.getAncestry(input.timelineIdA),
      this.provider.getAncestry(input.timelineIdB),
    ]);

    const commonAncestor = findCommonAncestor(ancestryA, ancestryB);
    const commonAncestorTimelineId = commonAncestor?.commonAncestorTimelineId ?? null;
    const forkPosition = commonAncestor?.forkPositionB ?? 0;

    const [eventsA, eventsB, scenarioInputs] = await Promise.all([
      this.provider.getEffectiveEvents(input.timelineIdA, input.aggregateId),
      this.provider.getEffectiveEvents(input.timelineIdB, input.aggregateId),
      this.provider.getScenarioInputs(input.timelineIdB),
    ]);

    const divergingEventsA = eventsA.filter((e) => (e.timeline_position ?? 0) > forkPosition);
    const divergingEventsB = eventsB.filter((e) => (e.timeline_position ?? 0) > forkPosition);

    let stateA: unknown = null;
    let stateB: unknown = null;
    let stateHashA: string | null = null;
    let stateHashB: string | null = null;
    let hashesMatch = true;

    if (input.aggregateId) {
      const [resA, resB] = await Promise.all([
        this.provider.getState(input.timelineIdA, input.aggregateId),
        this.provider.getState(input.timelineIdB, input.aggregateId),
      ]);

      stateA = resA?.state ?? null;
      stateHashA = resA?.stateHash ?? null;
      stateB = resB?.state ?? null;
      stateHashB = resB?.stateHash ?? null;

      hashesMatch = stateHashA !== null && stateHashB !== null && stateHashA === stateHashB;
    }

    const objA = (stateA && typeof stateA === 'object' ? stateA : {}) as Record<string, unknown>;
    const objB = (stateB && typeof stateB === 'object' ? stateB : {}) as Record<string, unknown>;

    let statusDiff: { from: unknown; to: unknown } | undefined;
    if (objA['status'] !== objB['status']) {
      statusDiff = { from: objA['status'], to: objB['status'] };
    }

    const fieldsChanged: Record<string, { from: unknown; to: unknown }> = {};
    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    for (const key of allKeys) {
      if (key === 'status') continue;
      const valA = objA[key];
      const valB = objB[key];
      if (canonicalJson(valA) !== canonicalJson(valB)) {
        fieldsChanged[key] = { from: valA, to: valB };
      }
    }

    // Identify divergence reason
    let divergenceReason: string | undefined;
    const failureInput = scenarioInputs.find((s) => s.inputType === 'ForcePaymentFailure');
    if (failureInput) {
      divergenceReason = `ScenarioInput 'ForcePaymentFailure' induced payment failure on timeline '${input.timelineIdB}', triggering backward saga compensation.`;
    }

    const stateDiff: StateDiff = {
      ...(statusDiff ? { status: statusDiff } : {}),
      ...(Object.keys(fieldsChanged).length > 0 ? { fieldsChanged } : {}),
      ...(divergenceReason ? { divergenceReason } : {}),
    };

    return {
      timelineIdA: input.timelineIdA,
      timelineIdB: input.timelineIdB,
      commonAncestorTimelineId,
      forkPosition,
      aggregateId: input.aggregateId ?? null,
      stateHashA,
      stateHashB,
      hashesMatch,
      stateA,
      stateB,
      stateDiff,
      divergingEventsA,
      divergingEventsB,
      scenarioInputs,
    };
  }
}
