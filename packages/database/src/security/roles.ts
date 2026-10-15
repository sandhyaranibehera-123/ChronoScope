/**
 * Phase 14: Security & Database Role Hardening
 *
 * Implements the Principle of Least Privilege across MySQL and MongoDB,
 * along with database-enforced immutability triggers (Rule 3, Rule 17).
 */

export class ImmutableEventStoreError extends Error {
  public readonly code = 'ERR_IMMUTABLE_EVENT_STORE';
  public readonly sqlState = '45000';

  constructor(operation: 'UPDATE' | 'DELETE', table: string) {
    const opText = operation === 'UPDATE' ? `Updates to ${table}` : `Deletions from ${table}`;
    super(
      `ImmutableEventStoreError: ${opText} are strictly forbidden by architectural rule 3 (SQLSTATE 45000)`,
    );
    this.name = 'ImmutableEventStoreError';
  }
}

export class PrivilegeDeniedError extends Error {
  public readonly code = 'ERR_PRIVILEGE_DENIED';

  constructor(role: string, operation: string, resource: string) {
    super(
      `PrivilegeDeniedError: Role '${role}' is not authorized to execute '${operation}' on '${resource}'.`,
    );
    this.name = 'PrivilegeDeniedError';
  }
}

export type DatabaseRole =
  | 'chronoscope_owner'
  | 'chronoscope_migrator'
  | 'chronoscope_app'
  | 'chronoscope_projection_worker'
  | 'chronoscope_rebuild_controller'
  | 'chronoscope_publisher';

export type SqlAction = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL';

/**
 * Authoritative MySQL Role Privilege Matrix (docs/architecture/database-ownership.md).
 */
export const MYSQL_ROLE_PRIVILEGES: Record<DatabaseRole, Record<string, readonly SqlAction[]>> = {
  chronoscope_owner: {
    '*': ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL'],
  },
  chronoscope_migrator: {
    'chronoscope_core.*': ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL'],
    'chronoscope_ops.*': ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL'],
  },
  chronoscope_app: {
    'chronoscope_core.events': ['SELECT', 'INSERT'],
    'chronoscope_core.system_events': ['SELECT', 'INSERT'],
    'chronoscope_core.timelines': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_core.aggregate_versions': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_core.aggregate_state': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_core.outbox': ['INSERT'],
    'chronoscope_core.timeline_position_seq': ['INSERT', 'SELECT'],
    'chronoscope_ops.command_deduplication': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.jobs': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.job_outbox': ['INSERT'],
    'chronoscope_ops.worker_controls': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.control_commands': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.executions': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.scenario_inputs': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.experiments': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.experiment_runs': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.experiment_invariants': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.audit_log': ['SELECT', 'INSERT'],
    'chronoscope_ops.inventory_items': ['SELECT', 'INSERT', 'UPDATE'],
  },
  chronoscope_projection_worker: {
    'chronoscope_core.events': ['SELECT'],
    'chronoscope_core.system_events': ['SELECT'],
    'chronoscope_core.timelines': ['SELECT'],
    'chronoscope_core.aggregate_versions': ['SELECT'],
    'chronoscope_core.aggregate_state': ['SELECT'],
    'chronoscope_ops.inbox': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.projection_checkpoints': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.projection_metadata': ['SELECT'], // Rule 17: Worker may NEVER write projection_metadata
  },
  chronoscope_rebuild_controller: {
    'chronoscope_core.events': ['SELECT'],
    'chronoscope_core.timelines': ['SELECT'],
    'chronoscope_core.aggregate_state': ['SELECT'],
    'chronoscope_ops.projection_metadata': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.projection_rebuild_runs': ['SELECT', 'INSERT', 'UPDATE'],
    'chronoscope_ops.projection_rebuild_cutoffs': ['SELECT', 'INSERT', 'UPDATE'],
  },
  chronoscope_publisher: {
    'chronoscope_core.outbox': ['SELECT', 'UPDATE'],
    'chronoscope_ops.job_outbox': ['SELECT', 'UPDATE'],
  },
};

/**
 * MongoDB Role Privileges for Rebuild Controller (docs/architecture/database-ownership.md).
 * Specifically NOT blanket readWrite on chronoscope_read.
 */
export const MONGO_REBUILD_PROJECTION_PRIVILEGES = {
  role: 'chronoscope_rebuild_projection',
  database: 'chronoscope_read',
  shadowCollectionActions: ['find', 'insert', 'update', 'remove', 'createIndex'] as const,
  targetCollectionActions: ['find', 'dropCollection'] as const,
  databaseActions: ['renameCollectionSameDB'] as const,
};

/**
 * Validates whether a database role has the privilege to perform an action on a table.
 */
export function hasTablePrivilege(role: DatabaseRole, table: string, action: SqlAction): boolean {
  if (role === 'chronoscope_owner') return true;

  const roleGrants = MYSQL_ROLE_PRIVILEGES[role];
  if (!roleGrants) return false;

  // Direct match
  const directActions = roleGrants[table];
  if (directActions && directActions.includes(action)) {
    return true;
  }

  // Schema wildcard match
  const [schema] = table.split('.');
  const schemaWildcard = `${schema}.*`;
  const schemaActions = roleGrants[schemaWildcard];
  if (schemaActions && schemaActions.includes(action)) {
    return true;
  }

  return false;
}

/**
 * Enforces role privilege, throwing PrivilegeDeniedError if unauthorized.
 */
export function assertRolePrivilege(role: DatabaseRole, table: string, action: SqlAction): void {
  if (!hasTablePrivilege(role, table, action)) {
    throw new PrivilegeDeniedError(role, action, table);
  }
}

/**
 * Simulates the MySQL event store immutability trigger (SIGNAL SQLSTATE '45000').
 */
export function assertEventStoreImmutability(
  table: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'SELECT',
): void {
  if (
    table === 'chronoscope_core.events' ||
    table === 'chronoscope_core.system_events' ||
    table === 'events' ||
    table === 'system_events'
  ) {
    if (operation === 'UPDATE' || operation === 'DELETE') {
      throw new ImmutableEventStoreError(operation, table);
    }
  }
}
