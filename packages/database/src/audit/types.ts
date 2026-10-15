// packages/database/src/audit/types.ts
// Phase 11: Audit logging for chaos engineering and security operations (Rule 21)

export interface AuditLogRecord {
  readonly auditId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly payload?: Record<string, unknown> | undefined;
  readonly timestamp?: Date | undefined;
}

export interface IAuditLogger {
  log(record: AuditLogRecord): Promise<void>;
  listRecent(limit?: number): Promise<AuditLogRecord[]>;
  listByTarget(targetType: string, targetId: string, limit?: number): Promise<AuditLogRecord[]>;
}
