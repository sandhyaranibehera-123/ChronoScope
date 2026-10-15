export interface IChaosAgent {
  pauseContainer(containerName: string): Promise<void>;
  unpauseContainer(containerName: string): Promise<void>;
  stopContainer(containerName: string, timeoutSec?: number): Promise<void>;
  startContainer(containerName: string): Promise<void>;
  restartContainer(containerName: string): Promise<void>;
  disconnectNetwork(containerName: string, networkName: string): Promise<void>;
  connectNetwork(containerName: string, networkName: string): Promise<void>;
  getContainerStatus(containerName: string): Promise<'running' | 'paused' | 'exited' | 'unknown'>;
}
