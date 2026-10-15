import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import {
  REPLAY_PROTO_PATH,
  type GrpcExecuteReplayRequest,
  type GrpcExecuteReplayResponse,
  type GrpcHealthCheckResponse,
} from '@chronoscope/contracts';
import { createLogger } from '@chronoscope/observability';

const logger = createLogger({ name: 'replay-worker-grpc-client' });

export interface DirectReplayHandler {
  executeDirect: (req: GrpcExecuteReplayRequest) => Promise<GrpcExecuteReplayResponse>;
  checkHealthDirect?: () => Promise<GrpcHealthCheckResponse>;
}

export interface ReplayWorkerClientOptions {
  address?: string;
  defaultTimeoutMs?: number;
  directHandler?: DirectReplayHandler;
}

export interface IReplayWorkerClient {
  executeReplay(
    request: GrpcExecuteReplayRequest,
    options?: { timeoutMs?: number; correlationId?: string; requestId?: string },
  ): Promise<GrpcExecuteReplayResponse>;
  checkHealth(timeoutMs?: number): Promise<GrpcHealthCheckResponse>;
  close(): void;
}

interface RawExecuteReplayResponse {
  execution_id: string;
  state_hash: string;
  live_state_hash: string;
  hash_parity_matched: boolean;
  events_replayed: number | string;
  summary: string;
  mode: string;
}

interface RawHealthCheckResponse {
  status: string;
}

type ReplayServiceClient = grpc.Client & {
  ExecuteReplay: (
    req: unknown,
    meta: grpc.Metadata,
    opts: { deadline: Date },
    callback: (err: grpc.ServiceError | null, res: RawExecuteReplayResponse) => void,
  ) => void;
  CheckHealth: (
    req: unknown,
    meta: grpc.Metadata,
    opts: { deadline: Date },
    callback: (err: grpc.ServiceError | null, res: RawHealthCheckResponse) => void,
  ) => void;
};

/**
 * ReplayWorkerGrpcClient — system-guarantees.md Rule 19 & ADR-011.
 * Provides typed, synchronous API ⇄ replay-worker RPC with deadlines and metadata propagation.
 */
export class ReplayWorkerGrpcClient implements IReplayWorkerClient {
  private client: ReplayServiceClient | null = null;
  private readonly address: string;
  private readonly defaultTimeoutMs: number;
  private readonly directHandler?: DirectReplayHandler | undefined;

  constructor(options?: ReplayWorkerClientOptions) {
    this.address = options?.address ?? process.env['REPLAY_WORKER_GRPC_URL'] ?? 'localhost:50051';
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 5000;
    this.directHandler = options?.directHandler;
  }

  private getClient(): ReplayServiceClient {
    if (this.client) return this.client;

    const packageDefinition = protoLoader.loadSync(REPLAY_PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
      chronoscope: {
        replay: {
          v1: {
            ReplayWorkerService: new (
              address: string,
              creds: grpc.ChannelCredentials,
            ) => ReplayServiceClient;
          };
        };
      };
    };

    this.client = new proto.chronoscope.replay.v1.ReplayWorkerService(
      this.address,
      grpc.credentials.createInsecure(),
    );

    return this.client;
  }

  public async executeReplay(
    request: GrpcExecuteReplayRequest,
    options?: { timeoutMs?: number; correlationId?: string; requestId?: string },
  ): Promise<GrpcExecuteReplayResponse> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    if (timeoutMs <= 0) {
      const deadlineError = new Error('4 DEADLINE_EXCEEDED: Deadline exceeded');
      (deadlineError as unknown as { code: number }).code = grpc.status.DEADLINE_EXCEEDED;
      throw deadlineError;
    }

    if (this.directHandler) {
      return this.directHandler.executeDirect(request);
    }

    const client = this.getClient();
    const deadline = new Date(Date.now() + timeoutMs);

    const metadata = new grpc.Metadata();
    if (options?.correlationId) metadata.set('x-correlation-id', options.correlationId);
    if (options?.requestId) metadata.set('x-request-id', options.requestId);

    const reqPayload = {
      timeline_id: request.timelineId,
      aggregate_id: request.aggregateId,
      aggregate_type: request.aggregateType,
      target_sequence: request.targetSequence ?? 0,
      mode: request.mode,
      scenario_seed: request.scenarioSeed ?? '',
      correlation_id: options?.correlationId ?? request.correlationId ?? '',
      request_id: options?.requestId ?? request.requestId ?? '',
      use_snapshot: request.useSnapshot,
      scenario_inputs_json: request.scenarioInputsJson ?? '',
    };

    return new Promise((resolve, reject) => {
      client.ExecuteReplay(reqPayload, metadata, { deadline }, (err, response) => {
        if (err) {
          logger.error({ err, request }, 'gRPC ExecuteReplay call failed');
          return reject(err);
        }

        resolve({
          executionId: response.execution_id,
          stateHash: response.state_hash,
          liveStateHash: response.live_state_hash,
          hashParityMatched: Boolean(response.hash_parity_matched),
          eventsReplayed: Number(response.events_replayed),
          summary: response.summary,
          mode: response.mode,
        });
      });
    });
  }

  public async checkHealth(timeoutMs: number = 2000): Promise<GrpcHealthCheckResponse> {
    if (this.directHandler) {
      return this.directHandler.checkHealthDirect
        ? this.directHandler.checkHealthDirect()
        : { status: 'SERVING' };
    }

    const client = this.getClient();
    const deadline = new Date(Date.now() + timeoutMs);
    const metadata = new grpc.Metadata();

    return new Promise((resolve, reject) => {
      client.CheckHealth(
        { service: 'ReplayWorkerService' },
        metadata,
        { deadline },
        (err, response) => {
          if (err) {
            return reject(err);
          }
          resolve({
            status: response.status === 'SERVING' ? 'SERVING' : 'NOT_SERVING',
          });
        },
      );
    });
  }

  public close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}
