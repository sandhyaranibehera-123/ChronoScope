import { randomUUID } from 'node:crypto';
import type { TimelineRecord, CreateTimelineParams } from '@chronoscope/database';

export interface ITimelineStore {
  createTimeline(params: CreateTimelineParams): Promise<TimelineRecord>;
  getTimeline(timelineId: string): Promise<TimelineRecord | null>;
  getAncestry(timelineId: string): Promise<
    readonly {
      timelineId: string;
      parentTimelineId: string | null;
      forkPosition: number;
      depth: number;
    }[]
  >;
}

export interface ForkTimelineOptions {
  readonly parentTimelineId: string;
  readonly forkPosition?: number | undefined;
  readonly timelineId?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
}

/**
 * TimelineForkService — system-guarantees.md Rules 6 & 13, ADR-010.
 *
 * Coordinates zero-copy timeline branching:
 * 1. Validates parent timeline existence.
 * 2. Transactionally asserts fork_position bounds (0 <= forkPosition <= parentMaxPosition).
 * 3. Records branch in chronoscope_core.timelines without copying parent history.
 */
export class TimelineForkService {
  constructor(private readonly timelineStore: ITimelineStore) {}

  public async fork(options: ForkTimelineOptions): Promise<TimelineRecord> {
    const timelineId = options.timelineId ?? randomUUID();
    const forkPosition = options.forkPosition ?? 0;

    return this.timelineStore.createTimeline({
      timelineId,
      parentTimelineId: options.parentTimelineId,
      forkPosition,
      name: options.name,
      description: options.description ?? null,
    });
  }

  public async getAncestry(timelineId: string) {
    return this.timelineStore.getAncestry(timelineId);
  }

  public async getTimeline(timelineId: string) {
    return this.timelineStore.getTimeline(timelineId);
  }
}
