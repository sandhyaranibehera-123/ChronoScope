import grpc from '@grpc/grpc-js';
import { createLogger } from '@chronoscope/observability';
import type { LiveReplayService, CounterfactualReplayService } from '@chronoscope/replay-engine';

const logger = createLogger({ name: 'replay-worker-service' });

export interface ExecuteReplayProtoRequest {
  timeline_id: string;
  aggregate_id: string;
  aggregate_type: string;
  target_sequence: number | string;
  mode: string;
  scenario_seed: string;
  correlation_id: string;
  request_id: string;
  use_snapshot: boolean;
  scenario_inputs_json: string;
}

export interface ExecuteReplayProtoResponse {
  execution_id: string;
  state_hash: string;
  live_state_hash: string;
  hash_parity_matched: boolean;
  events_replayed: number | string;
  summary: string;
  mode: string;
}

export interface HealthCheckProtoRequest {
  service: string;
}

export interface HealthCheckProtoResponse {
  status: string;
}

export class ReplayWorkerServiceImpl {
  constructor(
    private readonly liveReplayService: LiveReplayService,
    private readonly counterfactualReplayService: CounterfactualReplayService,
  ) {}

  public executeReplay = async (
    call: grpc.ServerUnaryCall<ExecuteReplayProtoRequest, ExecuteReplayProtoResponse>,
    callback: grpc.sendUnaryData<ExecuteReplayProtoResponse>,
  ): Promise<void> => {
    const req = call.request;
    const correlationId =
      (call.metadata.get('x-correlation-id')[0] as string) ?? req.correlation_id;
    const requestId = (call.metadata.get('x-request-id')[0] as string) ?? req.request_id;

    logger.info(
      {
        timelineId: req.timeline_id,
        aggregateId: req.aggregate_id,
        mode: req.mode,
        correlationId,
        requestId,
      },
      'Handling gRPC ExecuteReplay request',
    );

    // Rule 19 & ADR-011: check cancellation
    if (call.cancelled) {
      logger.warn('gRPC call cancelled by client');
      return callback({
        code: grpc.status.CANCELLED,
        details: 'Client cancelled the request',
      });
    }

    try {
      const mode = req.mode || 'LIVE_REPLAY';

      if (mode === 'COUNTERFACTUAL_REPLAY') {
        const result = await this.counterfactualReplayService.replayAggregate({
          timelineId: req.timeline_id,
          aggregateId: req.aggregate_id,
          aggregateType: req.aggregate_type || 'Order',
          scenarioSeed: req.scenario_seed || undefined,
        });

        if (call.cancelled) {
          return callback({
            code: grpc.status.CANCELLED,
            details: 'Client cancelled the request during replay execution',
          });
        }

        return callback(null, {
          execution_id: result.executionId,
          state_hash: result.stateHash,
          live_state_hash: result.liveStateHash,
          hash_parity_matched: result.hashParityMatched,
          events_replayed: result.eventsReplayed,
          summary: `Counterfactual replay executed: ${result.eventsReplayed} events replayed. Hash parity matched: ${result.hashParityMatched}.`,
          mode: 'COUNTERFACTUAL_REPLAY',
        });
      } else {
        const targetSeq = Number(req.target_sequence);
        const result = await this.liveReplayService.replayAggregate({
          timelineId: req.timeline_id,
          aggregateId: req.aggregate_id,
          aggregateType: req.aggregate_type || 'Order',
          targetSequence: targetSeq > 0 ? targetSeq : undefined,
          useSnapshot: req.use_snapshot ?? true,
          scenarioSeed: req.scenario_seed || undefined,
        });

        if (call.cancelled) {
          return callback({
            code: grpc.status.CANCELLED,
            details: 'Client cancelled the request during replay execution',
          });
        }

        return callback(null, {
          execution_id: result.executionId,
          state_hash: result.stateHash,
          live_state_hash: result.liveStateHash,
          hash_parity_matched: result.hashParityMatched,
          events_replayed: result.eventsReplayed,
          summary: `Live replay executed: ${result.eventsReplayed} events from sequence ${result.fromSequence} to ${result.toSequence}. Hash parity matched: ${result.hashParityMatched}.`,
          mode: 'LIVE_REPLAY',
        });
      }
    } catch (err) {
      logger.error({ err }, 'Error in gRPC ExecuteReplay execution');
      const details = err instanceof Error ? err.message : String(err);
      return callback({
        code: grpc.status.INTERNAL,
        details,
      });
    }
  };

  public checkHealth = (
    _call: grpc.ServerUnaryCall<HealthCheckProtoRequest, HealthCheckProtoResponse>,
    callback: grpc.sendUnaryData<HealthCheckProtoResponse>,
  ): void => {
    callback(null, { status: 'SERVING' });
  };

  public executeDirect = async (req: {
    timelineId: string;
    aggregateId: string;
    aggregateType?: string | undefined;
    targetSequence?: number | undefined;
    mode?: string | undefined;
    scenarioSeed?: string | undefined;
    useSnapshot?: boolean | undefined;
    correlationId?: string | undefined;
    requestId?: string | undefined;
    scenarioInputsJson?: string | undefined;
  }) => {
    const mode = req.mode || 'LIVE_REPLAY';
    if (mode === 'COUNTERFACTUAL_REPLAY') {
      const result = await this.counterfactualReplayService.replayAggregate({
        timelineId: req.timelineId,
        aggregateId: req.aggregateId,
        aggregateType: req.aggregateType || 'Order',
        scenarioSeed: req.scenarioSeed || undefined,
      });
      return {
        executionId: result.executionId,
        stateHash: result.stateHash,
        liveStateHash: result.liveStateHash,
        hashParityMatched: result.hashParityMatched,
        eventsReplayed: result.eventsReplayed,
        summary: `Counterfactual replay executed: ${result.eventsReplayed} events replayed. Hash parity matched: ${result.hashParityMatched}.`,
        mode: 'COUNTERFACTUAL_REPLAY',
      };
    } else {
      const result = await this.liveReplayService.replayAggregate({
        timelineId: req.timelineId,
        aggregateId: req.aggregateId,
        aggregateType: req.aggregateType || 'Order',
        targetSequence:
          req.targetSequence && req.targetSequence > 0 ? req.targetSequence : undefined,
        useSnapshot: req.useSnapshot ?? true,
        scenarioSeed: req.scenarioSeed || undefined,
      });
      return {
        executionId: result.executionId,
        stateHash: result.stateHash,
        liveStateHash: result.liveStateHash,
        hashParityMatched: result.hashParityMatched,
        eventsReplayed: result.eventsReplayed,
        summary: `Live replay executed: ${result.eventsReplayed} events from sequence ${result.fromSequence} to ${result.toSequence}. Hash parity matched: ${result.hashParityMatched}.`,
        mode: 'LIVE_REPLAY',
      };
    }
  };

  public checkHealthDirect = async () => {
    return { status: 'SERVING' as const };
  };
}
