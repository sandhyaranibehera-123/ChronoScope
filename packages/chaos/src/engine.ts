import { randomUUID } from 'node:crypto';
import { createLogger } from '@chronoscope/observability';
import {
  ChaosDisabledError,
  ChaosUnauthorizedError,
  ChaosLimitExceededError,
  FaultNotFoundError,
} from './errors.js';
import type {
  IChaosEngine,
  ChaosEngineOptions,
  FaultInjectionRequest,
  ActiveFault,
  ChaosKillSwitchResponse,
  FaultType,
} from './types.js';

const logger = createLogger({ name: 'chaos-engine' });

export class ChaosEngine implements IChaosEngine {
  private readonly chaosEnabled: boolean;
  private readonly maxConcurrentFaults: number;
  private readonly defaultTtlSeconds: number;
  private readonly activeFaults = new Map<string, ActiveFault>();
  private readonly faultTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly options?: ChaosEngineOptions) {
    this.chaosEnabled =
      options?.chaosEnabled ??
      (typeof process !== 'undefined' && process.env['CHAOS_MODE'] === 'true');
    this.maxConcurrentFaults = options?.maxConcurrentFaults ?? 5;
    this.defaultTtlSeconds = options?.defaultTtlSeconds ?? 60;
  }

  public get isEnabled(): boolean {
    return this.chaosEnabled;
  }

  private assertAllowed(actorRole: string): void {
    if (!this.chaosEnabled) {
      throw new ChaosDisabledError();
    }
    if (actorRole !== 'admin') {
      throw new ChaosUnauthorizedError();
    }
  }

  public async inject(
    request: FaultInjectionRequest,
    actorRole: string,
    actorId = 'admin-operator',
  ): Promise<ActiveFault> {
    this.assertAllowed(actorRole);

    if (this.activeFaults.size >= this.maxConcurrentFaults) {
      throw new ChaosLimitExceededError(this.maxConcurrentFaults);
    }

    const faultId = request.faultId ?? randomUUID();
    const ttlSeconds = Math.min(Math.max(request.ttlSeconds ?? this.defaultTtlSeconds, 1), 300);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const activeFault: ActiveFault = {
      faultId,
      layer: request.layer,
      type: request.type,
      target: request.target,
      parameters: {
        probability: 1.0,
        ...request.parameters,
      },
      injectedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      injectedBy: actorId,
    };

    this.activeFaults.set(faultId, activeFault);

    // Schedule automatic TTL expiration
    const timer = setTimeout(() => {
      this.expireFault(faultId);
    }, ttlSeconds * 1000);

    // Don't keep Node process alive just for the chaos timer
    if (timer.unref) {
      timer.unref();
    }
    this.faultTimers.set(faultId, timer);

    logger.warn(
      { fault: activeFault },
      `Chaos fault injected: ${request.type} on ${request.target}`,
    );

    if (this.options?.auditLogger) {
      await this.options.auditLogger.log({
        auditId: randomUUID(),
        actorId,
        action: 'INJECT_FAULT',
        targetType: request.layer,
        targetId: `${request.target}:${request.type}`,
        payload: {
          faultId,
          type: request.type,
          target: request.target,
          ttlSeconds,
          parameters: activeFault.parameters,
        },
      });
    }

    return activeFault;
  }

  private expireFault(faultId: string): void {
    const existing = this.activeFaults.get(faultId);
    if (!existing) return;

    this.clearTimer(faultId);
    this.activeFaults.delete(faultId);
    logger.info({ faultId }, `Chaos fault auto-expired via TTL`);

    if (this.options?.auditLogger) {
      void this.options.auditLogger.log({
        auditId: randomUUID(),
        actorId: 'system-ttl-reaper',
        action: 'EXPIRE_FAULT_TTL',
        targetType: existing.layer,
        targetId: `${existing.target}:${existing.type}`,
        payload: { faultId },
      });
    }
  }

  public async disarm(
    faultId: string,
    actorRole: string,
    actorId = 'admin-operator',
  ): Promise<boolean> {
    this.assertAllowed(actorRole);

    const existing = this.activeFaults.get(faultId);
    if (!existing) {
      throw new FaultNotFoundError(faultId);
    }

    this.clearTimer(faultId);
    this.activeFaults.delete(faultId);
    logger.info({ faultId }, `Chaos fault manually disarmed`);

    if (this.options?.auditLogger) {
      await this.options.auditLogger.log({
        auditId: randomUUID(),
        actorId,
        action: 'DISARM_FAULT',
        targetType: existing.layer,
        targetId: `${existing.target}:${existing.type}`,
        payload: { faultId },
      });
    }

    return true;
  }

  public async disarmAll(
    actorRole: string,
    actorId = 'admin-operator',
  ): Promise<ChaosKillSwitchResponse> {
    this.assertAllowed(actorRole);

    const disarmedFaultIds = Array.from(this.activeFaults.keys());
    for (const faultId of disarmedFaultIds) {
      this.clearTimer(faultId);
    }
    this.activeFaults.clear();

    const timestamp = new Date().toISOString();
    logger.warn(
      { disarmedCount: disarmedFaultIds.length },
      `Chaos kill-switch engaged! All faults disarmed.`,
    );

    if (this.options?.auditLogger) {
      await this.options.auditLogger.log({
        auditId: randomUUID(),
        actorId,
        action: 'ENGAGE_KILL_SWITCH',
        targetType: 'SYSTEM',
        targetId: 'all-faults',
        payload: {
          disarmedCount: disarmedFaultIds.length,
          disarmedFaultIds,
        },
      });
    }

    return {
      disarmedCount: disarmedFaultIds.length,
      disarmedFaultIds,
      timestamp,
    };
  }

  public getActiveFaults(): ActiveFault[] {
    return Array.from(this.activeFaults.values());
  }

  public getActiveFault(faultId: string): ActiveFault | undefined {
    return this.activeFaults.get(faultId);
  }

  public isFaultActive(type: FaultType, target?: string): boolean {
    return this.getFault(type, target) !== undefined;
  }

  public getFault(type: FaultType, target?: string): ActiveFault | undefined {
    for (const fault of this.activeFaults.values()) {
      if (fault.type === type && (!target || fault.target === target || fault.target === '*')) {
        // Evaluate probability
        if (fault.parameters.probability !== undefined && fault.parameters.probability < 1.0) {
          if (Math.random() > fault.parameters.probability) {
            continue;
          }
        }
        return fault;
      }
    }
    return undefined;
  }

  public async checkLatency(target: string): Promise<void> {
    const fault = this.getFault('LATENCY', target);
    if (fault && fault.parameters.latencyMs && fault.parameters.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, fault.parameters.latencyMs));
    }
  }

  public checkFailure(type: FaultType, target?: string): void {
    const fault = this.getFault(type, target);
    if (fault) {
      const msg =
        fault.parameters.errorMessage ?? `Simulated chaos failure: ${type} on ${target ?? '*'}`;
      throw new Error(msg);
    }
  }

  public async intercept<T>(
    target: string,
    type: FaultType,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.checkLatency(target);
    this.checkFailure(type, target);
    return await operation();
  }

  private clearTimer(faultId: string): void {
    const timer = this.faultTimers.get(faultId);
    if (timer) {
      clearTimeout(timer);
      this.faultTimers.delete(faultId);
    }
  }
}
