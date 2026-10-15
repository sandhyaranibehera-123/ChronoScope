import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { REPLAY_PROTO_PATH } from '@chronoscope/contracts';
import { createLogger } from '@chronoscope/observability';
import type { ReplayWorkerServiceImpl } from './service.js';

const logger = createLogger({ name: 'replay-worker-server' });

export interface ReplayWorkerServer {
  server: grpc.Server;
  start(port?: number): Promise<number>;
  stop(): Promise<void>;
}

export function createReplayWorkerServer(service: ReplayWorkerServiceImpl): ReplayWorkerServer {
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
          ReplayWorkerService: {
            service: grpc.ServiceDefinition;
          };
        };
      };
    };
  };

  const server = new grpc.Server();

  server.addService(proto.chronoscope.replay.v1.ReplayWorkerService.service, {
    ExecuteReplay: service.executeReplay,
    CheckHealth: service.checkHealth,
  });

  return {
    server,
    start: (port: number = 50051): Promise<number> => {
      return new Promise((resolve, reject) => {
        server.bindAsync(
          `0.0.0.0:${port}`,
          grpc.ServerCredentials.createInsecure(),
          (err, boundPort) => {
            if (err) {
              logger.error({ err, port }, 'Failed to bind gRPC server');
              return reject(err);
            }
            logger.info({ port: boundPort }, 'gRPC Replay Worker server bound and listening');
            resolve(boundPort);
          },
        );
      });
    },
    stop: (): Promise<void> => {
      return new Promise((resolve) => {
        server.tryShutdown(() => {
          logger.info('gRPC Replay Worker server stopped');
          resolve();
        });
      });
    },
  };
}
