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
import type { IExecutionManager, IScenarioInputManager } from '@chronoscope/database';
import type { IEventReader } from '../authoritative-state-resolver.js';
import type { ILiveStateProvider, ReplayResult } from './live-replay-service.js';
import { evaluateScenarioInputs } from '../scenarios/scenario-input.js';

const logger = createLogger({ name: 'counterfactual-replay-service' });

export interface CounterfactualReplayOptions {
  readonly timelineId: string;
  readonly aggregateId: string;
  readonly aggregateType?: string | undefined;
  readonly scenarioSeed?: string | number | undefined;
}

/**
 * CounterfactualReplayService — system-guarantees.md Rules 9, 11, 12, 13.
 *
 * Implements COUNTERFACTUAL_REPLAY:
 * 1. Driven by persisted scenario_inputs (Rule 12).
 * 2. Operates within ExecutionContext.createCounterfactual(...) with independent clocks.
 * 3. Folds effective events through registered domain reducers.
 * 4. Proves non-circular hash parity against branch's live aggregate_state.state_hash.
 * 5. Commits permanent audit record to chronoscope_ops.executions with mode = 'COUNTERFACTUAL_REPLAY'.
 */
export class CounterfactualReplayService {
  private readonly reducers = new Map<string, StateReducer<never, never>>();
  private readonly upcasterRegistry: UpcasterRegistry;

  constructor(
    private readonly eventReader: IEventReader,
    private readonly executionManager: IExecutionManager,
    private readonly scenarioInputManager: IScenarioInputManager,
    private readonly liveStateProvider: ILiveStateProvider,
    upcasterRegistry?: UpcasterRegistry,
  ) {
    this.upcasterRegistry = upcasterRegistry ?? new UpcasterRegistry();

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
    options: CounterfactualReplayOptions,
  ): Promise<ReplayResult<TState>> {
    const startTime = Date.now();
    const executionId = randomUUID();
    const aggregateType = options.aggregateType ?? 'Order';
    const scenarioSeed = options.scenarioSeed ?? 'counterfactual-seed';

    // 1. Record execution start in chronoscope_ops.executions
    await this.executionManager.createExecution({
      executionId,
      mode: 'COUNTERFACTUAL_REPLAY',
      timelineId: options.timelineId,
      aggregateId: options.aggregateId,
      fromSequence: 0,
      toSequence: null,
      snapshotId: null,
    });

    try {
      // 2. Load active scenario inputs for timeline
      const rawInputs = await this.scenarioInputManager.getInputsByTimeline(options.timelineId);
      const evaluated = evaluateScenarioInputs(rawInputs, options.aggregateId);

      // 3. Initialize ExecutionContext in COUNTERFACTUAL_REPLAY mode
      ExecutionContext.createCounterfactual(scenarioSeed, {
        forcePaymentFailure: evaluated.forcePaymentFailure,
        forceShipmentFailure: evaluated.forceShipmentFailure,
        delayMs: evaluated.delayMs,
      });

      // 4. Load events for aggregate on this timeline
      const rawEvents = await this.eventReader.loadEventsForAggregate(
        options.timelineId,
        options.aggregateId,
      );

      // 5. Upcast events
      const upcastedEvents: DomainEvent[] = [];
      for (const event of rawEvents) {
        const currentVersion = event.schema_version;
        const upcastedPayload = this.upcasterRegistry.upcast(
          event.event_type,
          event.payload,
          currentVersion,
          currentVersion,
        );
        upcastedEvents.push({
          ...event,
          payload: upcastedPayload,
        });
      }

      // 6. Fold events through domain reducer
      const reducer = this.reducers.get(aggregateType);
      if (!reducer) {
        throw new Error(`No registered state reducer for aggregate type '${aggregateType}'`);
      }

      let finalState: TState | null = null;
      let stateHash = computeStateHash(null);
      let toSequence = 0;

      if (upcastedEvents.length > 0) {
        let currentState: TState | null = null;
        for (const event of upcastedEvents) {
          currentState = (reducer as unknown as (s: unknown, e: unknown) => TState)(
            currentState,
            event,
          );
        }
        finalState = currentState;
        stateHash = computeStateHash(finalState);
        toSequence = upcastedEvents[upcastedEvents.length - 1]?.aggregate_sequence ?? 0;
      }

      // 7. Load live state to verify hash parity
      const liveRecord = await this.liveStateProvider.getLiveState(
        options.timelineId,
        options.aggregateId,
      );
      const liveStateHash = liveRecord?.stateHash ?? '';
      const hashParityMatched = liveStateHash.length > 0 && liveStateHash === stateHash;

      const durationMs = Date.now() - startTime;

      // 8. Update execution record in chronoscope_ops.executions
      await this.executionManager.completeExecution(executionId, {
        eventsReplayed: upcastedEvents.length,
        stateHash,
        liveStateHash,
        hashParityMatched,
        summary: {
          aggregateType,
          scenarioSeed,
          eventsReplayed: upcastedEvents.length,
          toSequence,
          durationMs,
          scenarioInputsCount: rawInputs.length,
        },
      });

      logger.info(
        {
          executionId,
          timelineId: options.timelineId,
          aggregateId: options.aggregateId,
          hashParityMatched,
        },
        'Counterfactual replay completed',
      );

      return {
        executionId,
        timelineId: options.timelineId,
        aggregateId: options.aggregateId,
        aggregateType,
        fromSequence: 0,
        toSequence,
        snapshotId: null,
        eventsReplayed: upcastedEvents.length,
        state: finalState,
        stateHash,
        liveStateHash,
        hashParityMatched,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.executionManager.failExecution(executionId, errorMessage);

      throw error;
    }
  }
}
