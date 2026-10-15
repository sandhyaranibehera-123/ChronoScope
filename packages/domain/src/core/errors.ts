/**
 * Typed Failure Categories & Retry Classification — system-guarantees.md rule 16:
 * "Commands have typed failure categories and retry classification.
 * Command dedup stores the full outcome in MySQL."
 */

export type FailureCategory =
  | 'VALIDATION_ERROR'
  | 'CONCURRENCY_CONFLICT'
  | 'INVARIANT_VIOLATION'
  | 'PRECONDITION_FAILED'
  | 'NOT_FOUND'
  | 'SYSTEM_ERROR';

export type RetryClassification = 'RETRYABLE' | 'NON_RETRYABLE' | 'FATAL';

export interface DomainErrorDetails {
  readonly category: FailureCategory;
  readonly retryClassification: RetryClassification;
  readonly code: string;
  readonly message: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export class DomainError extends Error {
  readonly category: FailureCategory;
  readonly retryClassification: RetryClassification;
  readonly code: string;
  readonly metadata?: Record<string, unknown> | undefined;

  constructor(details: DomainErrorDetails) {
    super(details.message);
    this.name = 'DomainError';
    this.category = details.category;
    this.retryClassification = details.retryClassification;
    this.code = details.code;
    this.metadata = details.metadata;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): DomainErrorDetails {
    return {
      category: this.category,
      retryClassification: this.retryClassification,
      code: this.code,
      message: this.message,
      ...(this.metadata ? { metadata: this.metadata } : {}),
    };
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    codeOrMetadata?: string | Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) {
    const code = typeof codeOrMetadata === 'string' ? codeOrMetadata : 'ERR_VALIDATION';
    const meta = typeof codeOrMetadata === 'object' ? codeOrMetadata : metadata;
    super({
      category: 'VALIDATION_ERROR',
      retryClassification: 'NON_RETRYABLE',
      code,
      message,
      metadata: meta,
    });
    this.name = 'ValidationError';
  }
}

export class ConcurrencyConflictError extends DomainError {
  constructor(
    message: string,
    codeOrMetadata?: string | Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) {
    const code = typeof codeOrMetadata === 'string' ? codeOrMetadata : 'ERR_CONCURRENCY_CONFLICT';
    const meta = typeof codeOrMetadata === 'object' ? codeOrMetadata : metadata;
    super({
      category: 'CONCURRENCY_CONFLICT',
      retryClassification: 'RETRYABLE',
      code,
      message,
      metadata: meta,
    });
    this.name = 'ConcurrencyConflictError';
  }
}

export { ConcurrencyConflictError as ConcurrencyError };

export class InvariantViolationError extends DomainError {
  constructor(
    message: string,
    codeOrMetadata?: string | Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) {
    const code = typeof codeOrMetadata === 'string' ? codeOrMetadata : 'ERR_INVARIANT_VIOLATION';
    const meta = typeof codeOrMetadata === 'object' ? codeOrMetadata : metadata;
    super({
      category: 'INVARIANT_VIOLATION',
      retryClassification: 'NON_RETRYABLE',
      code,
      message,
      metadata: meta,
    });
    this.name = 'InvariantViolationError';
  }
}

export class PreconditionFailedError extends DomainError {
  constructor(
    message: string,
    codeOrMetadata?: string | Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) {
    const code = typeof codeOrMetadata === 'string' ? codeOrMetadata : 'ERR_PRECONDITION_FAILED';
    const meta = typeof codeOrMetadata === 'object' ? codeOrMetadata : metadata;
    super({
      category: 'PRECONDITION_FAILED',
      retryClassification: 'NON_RETRYABLE',
      code,
      message,
      metadata: meta,
    });
    this.name = 'PreconditionFailedError';
  }
}

export class NotFoundError extends DomainError {
  constructor(
    message: string,
    codeOrMetadata?: string | Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) {
    const code = typeof codeOrMetadata === 'string' ? codeOrMetadata : 'ERR_NOT_FOUND';
    const meta = typeof codeOrMetadata === 'object' ? codeOrMetadata : metadata;
    super({
      category: 'NOT_FOUND',
      retryClassification: 'NON_RETRYABLE',
      code,
      message,
      metadata: meta,
    });
    this.name = 'NotFoundError';
  }
}

export class SystemError extends DomainError {
  constructor(
    message: string,
    codeOrMetadata?: string | Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) {
    const code = typeof codeOrMetadata === 'string' ? codeOrMetadata : 'ERR_SYSTEM';
    const meta = typeof codeOrMetadata === 'object' ? codeOrMetadata : metadata;
    super({
      category: 'SYSTEM_ERROR',
      retryClassification: 'FATAL',
      code,
      message,
      metadata: meta,
    });
    this.name = 'SystemError';
  }
}
