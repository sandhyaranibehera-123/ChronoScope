export class ChaosDisabledError extends Error {
  constructor(message = 'Chaos mode is disabled. Set CHAOS_MODE=true to enable fault injection.') {
    super(message);
    this.name = 'ChaosDisabledError';
  }
}

export class ChaosUnauthorizedError extends Error {
  constructor(message = 'Chaos operations require admin role authorization.') {
    super(message);
    this.name = 'ChaosUnauthorizedError';
  }
}

export class ChaosLimitExceededError extends Error {
  constructor(maxLimit: number) {
    super(`Cannot inject fault: maximum concurrent active faults limit (${maxLimit}) reached.`);
    this.name = 'ChaosLimitExceededError';
  }
}

export class FaultNotFoundError extends Error {
  constructor(faultId: string) {
    super(`Active fault with ID '${faultId}' was not found.`);
    this.name = 'FaultNotFoundError';
  }
}
