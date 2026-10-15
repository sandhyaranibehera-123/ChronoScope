import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@chronoscope/observability';
import type { IChaosAgent } from './types.js';

const execFileAsync = promisify(execFile);
const logger = createLogger({ name: 'docker-chaos-agent' });

export class DockerChaosAgent implements IChaosAgent {
  private async runDocker(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('docker', args);
      return stdout.trim();
    } catch (error) {
      logger.error({ args, error }, 'Docker CLI command failed');
      throw new Error(
        `Docker command 'docker ${args.join(' ')}' failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async pauseContainer(containerName: string): Promise<void> {
    await this.runDocker(['pause', containerName]);
    logger.warn({ containerName }, 'Container paused via DockerChaosAgent');
  }

  public async unpauseContainer(containerName: string): Promise<void> {
    await this.runDocker(['unpause', containerName]);
    logger.info({ containerName }, 'Container unpaused via DockerChaosAgent');
  }

  public async stopContainer(containerName: string, timeoutSec = 5): Promise<void> {
    await this.runDocker(['stop', '-t', String(timeoutSec), containerName]);
    logger.warn({ containerName }, 'Container stopped via DockerChaosAgent');
  }

  public async startContainer(containerName: string): Promise<void> {
    await this.runDocker(['start', containerName]);
    logger.info({ containerName }, 'Container started via DockerChaosAgent');
  }

  public async restartContainer(containerName: string): Promise<void> {
    await this.runDocker(['restart', containerName]);
    logger.info({ containerName }, 'Container restarted via DockerChaosAgent');
  }

  public async disconnectNetwork(containerName: string, networkName: string): Promise<void> {
    await this.runDocker(['network', 'disconnect', networkName, containerName]);
    logger.warn(
      { containerName, networkName },
      'Container disconnected from network via DockerChaosAgent',
    );
  }

  public async connectNetwork(containerName: string, networkName: string): Promise<void> {
    await this.runDocker(['network', 'connect', networkName, containerName]);
    logger.info(
      { containerName, networkName },
      'Container reconnected to network via DockerChaosAgent',
    );
  }

  public async getContainerStatus(
    containerName: string,
  ): Promise<'running' | 'paused' | 'exited' | 'unknown'> {
    try {
      const status = await this.runDocker(['inspect', '-f', '{{.State.Status}}', containerName]);
      if (status === 'running' || status === 'paused' || status === 'exited') {
        return status;
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
