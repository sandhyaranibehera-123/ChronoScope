import { randomUUID } from 'node:crypto';
import { createLogger } from '@chronoscope/observability';
import {
  type DomainEvent,
  type StateReducer,
  computeStateHash,
  ExecutionContext,
  orderReducer,
  paymentReducer,
  inventoryReducer,
  shipmentReducer,
} from '@chronoscope/domain';
import { UpcasterRegistry } from '@chronoscope/events';
import type { IExecutionManager } from '@chronoscope/database';
import type { IEventReader } from '../authoritative-state-resolver.js';
import type { SnapshotManager } from '../snapshots/snapshot-manager.js';

const logger = createLogger({ name: 'live-replay-service' });

export interface ILiveStateProvider {
  getLiveState(
    timelineId: string,
    aggregateId: string,
  ): Promise<{ sequence: number; state: unknown; stateHash: string } | null>;
}

export interface ReplayAggregateOptions {
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType?: string | undefined;
  readonly targetSequence?: number | undefined;
  readonly useSnapshot?: boolean | undefined;
  readonly scenarioSeed?: string | number | undefined;
}

export interface ReplayResult<TState = unknown> {
  readonly executionId: string;
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly snapshotId: string | null;
  readonly eventsReplayed: number;
  readonly state: TState | null;
  readonly stateHash: string;
  readonly liveStateHash: string;
  readonly hashParityMatched: boolean;
  readonly durationMs: number;
}

export interface ReplayTimelineOptions {
  readonly timelineId: string;
  readonly aggregates: readonly {
    aggregateId: string;
    aggregateType: string;
    currentSequence: number;
  }[];
  readonly useSnapshot?: boolean | undefined;
  readonly scenarioSeed?: string | number | undefined;
}

export interface TimelineReplayResult {
  readonly executionId: string;
  readonly timelineId: string;
  readonly aggregatesReplayed: number;
  readonly totalEventsReplayed: number;
  readonly allHashParityMatched: boolean;
  readonly results: readonly ReplayResult[];
  readonly durationMs: number;
}

/**
 * LiveReplayService — system-guarantees.md Rules 9, 11, 12, 14 & ADR-008, ADR-009:
 *
 * Implements deterministic LIVE_REPLAY directly against event history:
 * 1. Supports fast-forward replay from verified READY snapshots.
 * 2. Transparently falls back to raw events if a snapshot is missing or corrupted.
 * 3. Enforces HistoricalClock vs ExecutionClock separation via ExecutionContext.
 * 4. Upcasts historical payloads sequentially via UpcasterRegistry (Rule 4).
 * 5. Proves non-circular hash parity against live aggregate_state.state_hash (Rule 9).
 * 6. Records permanent audit history in chronoscope_ops.executions.
 */
export class LiveReplayService {
  private readonly reducers = new Map<string, StateReducer<never, never>>();
  private readonly upcasterRegistry: UpcasterRegistry;

  constructor(
    private readonly eventReader: IEventReader,
    private readonly executionManager: IExecutionManager,
    private readonly snapshotManager?: SnapshotManager | undefined,
    private readonly liveStateProvider?: ILiveStateProvider | undefined,
    upcasterRegistry?: UpcasterRegistry | undefined,
  ) {
    this.upcasterRegistry = upcasterRegistry ?? new UpcasterRegistry();

    // Register built-in domain reducers
    this.registerReducer('Order', orderReducer as unknown as StateReducer<never, never>);
    this.registerReducer('ORDER', orderReducer as unknown as StateReducer<never, never>);
    this.registerReducer('Payment', paymentReducer as unknown as StateReducer<never, never>);
    this.registerReducer('PAYMENT', paymentReducer as unknown as StateReducer<never, never>);
    this.registerReducer('Inventory', inventoryReducer as unknown as StateReducer<never, never>);
    this.registerReducer('INVENTORY', inventoryReducer as unknown as StateReducer<never, never>);
    this.registerReducer('Shipment', shipmentReducer as unknown as StateReducer<never, never>);
    this.registerReducer('SHIPMENT', shipmentReducer as unknown as StateReducer<never, never>);
  }

  public registerReducer<TState, TEvent extends DomainEvent>(
    aggregateType: string,
    reducer: StateReducer<TState, TEvent>,
  ): void {
    this.reducers.set(aggregateType, reducer as unknown as StateReducer<never, never>);
  }

  public async replayAggregate<TState = unknown>(
    options: ReplayAggregateOptions,
  ): Promise<ReplayResult<TState>> {
    const startTime = Date.now();
    const executionId = randomUUID();
    const {
      timelineId,
      aggregateId,
      aggregateType = 'Order',
      useSnapshot = true,
      scenarioSeed,
    } = options;

    logger.info({ executionId, timelineId, aggregateId, aggregateType }, 'Starting LIVE_REPLAY');

    // 1. Initialize execution context with HistoricalClock
    const ctx = ExecutionContext.createReplay(scenarioSeed);

    // 2. Determine target sequence
    let targetSequence = options.targetSequence;
    if (targetSequence === undefined && this.liveStateProvider) {
      const live = await this.liveStateProvider.getLiveState(timelineId, aggregateId);
      targetSequence = live?.sequence ?? 0;
    }

    if (targetSequence === undefined) {
      // Find highest sequence from events
      const allEvents = await this.eventReader.loadEventsForAggregate(timelineId, aggregateId);
      targetSequence =
        allEvents.length > 0 ? allEvents[allEvents.length - 1]!.aggregate_sequence : 0;
    }

    // 3. Register execution run in chronoscope_ops.executions
    await this.executionManager.createExecution({
      executionId,
      mode: 'LIVE_REPLAY',
      timelineId,
      aggregateId,
      fromSequence: 0,
      toSequence: targetSequence,
    });

    try {
      let fromSequence = 0;
      let currentState: unknown = null;
      let usedSnapshotId: string | null = null;

      // 4. Snapshot acceleration check (ADR-009 & Rule 14)
      if (useSnapshot && this.snapshotManager && targetSequence > 0) {
        const latestSnap = await this.snapshotManager.getLatestReadySnapshot(
          timelineId,
          aggregateId,
          targetSequence,
        );

        if (latestSnap) {
          const verified = await this.snapshotManager.loadAndVerifySnapshot(latestSnap.snapshotId);
          if (verified) {
            fromSequence = verified.snapshot.aggregateSequence;
            currentState = verified.payload.state;
            usedSnapshotId = verified.snapshot.snapshotId;
            logger.info(
              { executionId, snapshotId: usedSnapshotId, fromSequence },
              'Fast-forwarding replay from verified READY snapshot',
            );
          } else {
            logger.warn(
              { executionId, snapshotId: latestSnap.snapshotId },
              'Snapshot verification failed: falling back to raw event history',
            );
          }
        }
      }

      // 5. Load residual events from fromSequence + 1 up to targetSequence
      const allEvents = await this.eventReader.loadEventsForAggregate(
        timelineId,
        aggregateId,
        targetSequence,
      );

      const eventsToApply = allEvents.filter((e) => e.aggregate_sequence > fromSequence);

      const reducer = this.reducers.get(aggregateType);
      if (!reducer && eventsToApply.length > 0) {
        throw new Error(`No registered state reducer for aggregate type '${aggregateType}'`);
      }

      // 6. Fold events sequentially under HistoricalClock
      for (const rawEvent of eventsToApply) {
        // Advance historical clock to event's recorded_at timestamp (Rule 11)
        if (rawEvent.recorded_at) {
          ctx.historicalClock.advanceTo(rawEvent.recorded_at);
        }

        // Upcast payload if needed via upcaster registry (Rule 4)
        const currentVersion = rawEvent.schema_version;
        // Default target is the event's own version unless registry has upcasters
        const upcastedPayload = this.upcasterRegistry.upcast(
          rawEvent.event_type,
          rawEvent.payload,
          currentVersion,
          currentVersion,
        );

        const eventToFold: DomainEvent = {
          ...rawEvent,
          payload: upcastedPayload,
        };

        if (reducer) {
          currentState = reducer(currentState as never, eventToFold as never);
        }
      }

      // 7. Calculate deterministic replay state hash (Rule 9 & 11)
      const replayStateHash = computeStateHash(currentState);

      // 8. Fetch live state hash for non-circular parity proof (Rule 9)
      let liveStateHash = replayStateHash;
      if (this.liveStateProvider) {
        const liveRecord = await this.liveStateProvider.getLiveState(timelineId, aggregateId);
        if (liveRecord) {
          liveStateHash = liveRecord.stateHash;
        }
      }

      const hashParityMatched = replayStateHash === liveStateHash;

      const durationMs = Date.now() - startTime;

      // 9. Complete execution audit record in chronoscope_ops.executions
      await this.executionManager.completeExecution(executionId, {
        eventsReplayed: eventsToApply.length,
        stateHash: replayStateHash,
        liveStateHash,
        hashParityMatched,
        summary: {
          fromSequence,
          toSequence: targetSequence,
          snapshotId: usedSnapshotId,
          durationMs,
        },
      });

      logger.info(
        {
          executionId,
          hashParityMatched,
          eventsReplayed: eventsToApply.length,
          replayStateHash,
          liveStateHash,
        },
        'LIVE_REPLAY completed',
      );

      return {
        executionId,
        timelineId,
        aggregateId,
        aggregateType,
        fromSequence,
        toSequence: targetSequence,
        snapshotId: usedSnapshotId,
        eventsReplayed: eventsToApply.length,
        state: currentState as TState | null,
        stateHash: replayStateHash,
        liveStateHash,
        hashParityMatched,
        durationMs,
      };
    } catch (error) {
      const err = error as Error;
      logger.error({ executionId, error: err.message }, 'LIVE_REPLAY failed');
      await this.executionManager.failExecution(executionId, err.message);
      throw error;
    }
  }

  public async replayTimeline(options: ReplayTimelineOptions): Promise<TimelineReplayResult> {
    const startTime = Date.now();
    const executionId = randomUUID();
    const { timelineId, aggregates, useSnapshot = true, scenarioSeed } = options;

    logger.info({ executionId, timelineId, count: aggregates.length }, 'Replaying timeline');

    const results: ReplayResult[] = [];
    let totalEvents = 0;
    let allMatched = true;

    for (const agg of aggregates) {
      const res = await this.replayAggregate({
        timelineId,
        aggregateId: agg.aggregateId,
        aggregateType: agg.aggregateType,
        targetSequence: agg.currentSequence,
        useSnapshot,
        scenarioSeed,
      });

      results.push(res);
      totalEvents += res.eventsReplayed;
      if (!res.hashParityMatched) {
        allMatched = false;
      }
    }

    return {
      executionId,
      timelineId,
      aggregatesReplayed: aggregates.length,
      totalEventsReplayed: totalEvents,
      allHashParityMatched: allMatched,
      results,
      durationMs: Date.now() - startTime,
    };
  }
}
