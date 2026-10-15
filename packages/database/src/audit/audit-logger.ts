import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SQL } from '../sql/statements.js';
import type { IAuditLogger, AuditLogRecord } from './types.js';

interface AuditLogRow extends RowDataPacket {
  audit_id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  payload: string | Record<string, unknown> | null;
  timestamp: string | Date;
}

function mapAuditLogRow(row: AuditLogRow): AuditLogRecord {
  let payload: Record<string, unknown> | undefined;
  if (row.payload) {
    payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  }

  return {
    auditId: row.audit_id,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    payload,
    timestamp: new Date(row.timestamp),
  };
}

export class MysqlAuditLogger implements IAuditLogger {
  constructor(private readonly pool: Pool) {}

  public async log(record: AuditLogRecord): Promise<void> {
    await this.pool.execute(SQL.INSERT_AUDIT_LOG, [
      record.auditId,
      record.actorId,
      record.action,
      record.targetType,
      record.targetId,
      record.payload ? JSON.stringify(record.payload) : null,
    ]);
  }

  public async listRecent(limit: number = 50): Promise<AuditLogRecord[]> {
    const [rows] = await this.pool.query<AuditLogRow[]>(SQL.SELECT_RECENT_AUDIT_LOGS, [limit]);
    return rows.map(mapAuditLogRow);
  }

  public async listByTarget(
    targetType: string,
    targetId: string,
    limit: number = 50,
  ): Promise<AuditLogRecord[]> {
    const [rows] = await this.pool.query<AuditLogRow[]>(SQL.SELECT_AUDIT_LOGS_BY_TARGET, [
      targetType,
      targetId,
      limit,
    ]);
    return rows.map(mapAuditLogRow);
  }
}

export class InMemoryAuditLogger implements IAuditLogger {
  private readonly records: Array<AuditLogRecord & { _seq: number }> = [];
  private seq = 0;

  public async log(record: AuditLogRecord): Promise<void> {
    this.records.push({
      ...record,
      _seq: ++this.seq,
      timestamp: record.timestamp ?? new Date(),
    });
  }

  public async listRecent(limit: number = 50): Promise<AuditLogRecord[]> {
    return [...this.records]
      .sort((a, b) => {
        const timeDiff = (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0);
        return timeDiff !== 0 ? timeDiff : b._seq - a._seq;
      })
      .slice(0, limit);
  }

  public async listByTarget(
    targetType: string,
    targetId: string,
    limit: number = 50,
  ): Promise<AuditLogRecord[]> {
    return this.records
      .filter((r) => r.targetType === targetType && r.targetId === targetId)
      .sort((a, b) => {
        const timeDiff = (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0);
        return timeDiff !== 0 ? timeDiff : b._seq - a._seq;
      })
      .slice(0, limit);
  }
}
