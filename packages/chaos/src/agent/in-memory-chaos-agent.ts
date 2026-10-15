import type { IChaosAgent } from './types.js';

export class InMemoryChaosAgent implements IChaosAgent {
  public readonly containerStates = new Map<string, 'running' | 'paused' | 'exited'>();
  public readonly disconnectedNetworks = new Set<string>();

  constructor(initialContainers: string[] = []) {
    for (const name of initialContainers) {
      this.containerStates.set(name, 'running');
    }
  }

  public async pauseContainer(containerName: string): Promise<void> {
    this.containerStates.set(containerName, 'paused');
  }

  public async unpauseContainer(containerName: string): Promise<void> {
    this.containerStates.set(containerName, 'running');
  }

  public async stopContainer(containerName: string): Promise<void> {
    this.containerStates.set(containerName, 'exited');
  }

  public async startContainer(containerName: string): Promise<void> {
    this.containerStates.set(containerName, 'running');
  }

  public async restartContainer(containerName: string): Promise<void> {
    this.containerStates.set(containerName, 'running');
  }

  public async disconnectNetwork(containerName: string, networkName: string): Promise<void> {
    this.disconnectedNetworks.add(`${containerName}:${networkName}`);
  }

  public async connectNetwork(containerName: string, networkName: string): Promise<void> {
    this.disconnectedNetworks.delete(`${containerName}:${networkName}`);
  }

  public async getContainerStatus(
    containerName: string,
  ): Promise<'running' | 'paused' | 'exited' | 'unknown'> {
    return this.containerStates.get(containerName) ?? 'unknown';
  }
}
