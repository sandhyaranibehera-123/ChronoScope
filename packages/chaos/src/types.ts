import type {
  FaultLayer,
  FaultType,
  FaultParameters,
  FaultInjectionRequest,
  ActiveFault,
  ChaosKillSwitchResponse,
} from '@chronoscope/contracts';
import type { IAuditLogger } from '@chronoscope/database';

export type {
  FaultLayer,
  FaultType,
  FaultParameters,
  FaultInjectionRequest,
  ActiveFault,
  ChaosKillSwitchResponse,
};

export interface ChaosEngineOptions {
  readonly chaosEnabled?: boolean | undefined;
  readonly auditLogger?: IAuditLogger | undefined;
  readonly maxConcurrentFaults?: number | undefined;
  readonly defaultTtlSeconds?: number | undefined;
}

export interface IChaosEngine {
  readonly isEnabled: boolean;
  inject(request: FaultInjectionRequest, actorRole: string, actorId?: string): Promise<ActiveFault>;
  disarm(faultId: string, actorRole: string, actorId?: string): Promise<boolean>;
  disarmAll(actorRole: string, actorId?: string): Promise<ChaosKillSwitchResponse>;
  getActiveFaults(): ActiveFault[];
  getActiveFault(faultId: string): ActiveFault | undefined;
  isFaultActive(type: FaultType, target?: string): boolean;
  getFault(type: FaultType, target?: string): ActiveFault | undefined;
  checkLatency(target: string): Promise<void>;
  checkFailure(type: FaultType, target?: string): void;
  intercept<T>(target: string, type: FaultType, operation: () => Promise<T>): Promise<T>;
}
