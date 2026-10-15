import { ChaosAgentService } from './agent.js';

export * from './agent.js';

async function main(): Promise<void> {
  const service = new ChaosAgentService();
  await service.start();

  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

if (process.env['NODE_ENV'] !== 'test') {
  main().catch((err) => {
    console.error('Fatal Chaos Agent error:', err);
    process.exit(1);
  });
}
