import { createLogger } from '@chronoscope/observability';
import { DockerChaosAgent, InMemoryChaosAgent, type IChaosAgent } from '@chronoscope/chaos';

const logger = createLogger({ name: 'chaos-agent-service' });

export interface ChaosAgentServiceOptions {
  readonly useInMemory?: boolean;
}

export class ChaosAgentService {
  private readonly agent: IChaosAgent;
  private isRunning = false;

  constructor(options?: ChaosAgentServiceOptions) {
    if (options?.useInMemory || process.env['NODE_ENV'] === 'test') {
      this.agent = new InMemoryChaosAgent([
        'chronoscope-mysql',
        'chronoscope-mongo',
        'chronoscope-redis',
      ]);
    } else {
      this.agent = new DockerChaosAgent();
    }
  }

  public getChaosAgent(): IChaosAgent {
    return this.agent;
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    logger.info('Chaos Agent service started and listening for infrastructure disruption commands');
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('Chaos Agent service stopped cleanly');
  }

  public get running(): boolean {
    return this.isRunning;
  }
}
