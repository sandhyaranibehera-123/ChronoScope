import { describe, expect, it } from 'vitest';
import {
  assertEventStoreImmutability,
  assertRolePrivilege,
  hasTablePrivilege,
  ImmutableEventStoreError,
  PrivilegeDeniedError,
  MONGO_REBUILD_PROJECTION_PRIVILEGES,
} from '../security/index.js';

describe('Security & Database Role Hardening (Phase 14, Rules 3, 17 & ADR-016)', () => {
  // ---------------------------------------------------------------------------
  // 1. MySQL Trigger-Enforced Event Store Immutability (Rule 3)
  // ---------------------------------------------------------------------------
  describe('Rule 3: Multi-Layer Event Store Immutability', () => {
    it('rejects UPDATE operations on chronoscope_core.events with SQLSTATE 45000', () => {
      expect(() => {
        assertEventStoreImmutability('chronoscope_core.events', 'UPDATE');
      }).toThrow(ImmutableEventStoreError);

      try {
        assertEventStoreImmutability('chronoscope_core.events', 'UPDATE');
      } catch (err) {
        const immErr = err as ImmutableEventStoreError;
        expect(immErr.sqlState).toBe('45000');
        expect(immErr.code).toBe('ERR_IMMUTABLE_EVENT_STORE');
        expect(immErr.message).toContain(
          'Updates to chronoscope_core.events are strictly forbidden',
        );
      }
    });

    it('rejects DELETE operations on chronoscope_core.events with SQLSTATE 45000', () => {
      expect(() => {
        assertEventStoreImmutability('chronoscope_core.events', 'DELETE');
      }).toThrow(ImmutableEventStoreError);

      try {
        assertEventStoreImmutability('chronoscope_core.events', 'DELETE');
      } catch (err) {
        const immErr = err as ImmutableEventStoreError;
        expect(immErr.sqlState).toBe('45000');
        expect(immErr.code).toBe('ERR_IMMUTABLE_EVENT_STORE');
        expect(immErr.message).toContain(
          'Deletions from chronoscope_core.events are strictly forbidden',
        );
      }
    });

    it('applies the same immutable triggers to chronoscope_core.system_events', () => {
      expect(() => {
        assertEventStoreImmutability('chronoscope_core.system_events', 'UPDATE');
      }).toThrow(ImmutableEventStoreError);

      expect(() => {
        assertEventStoreImmutability('chronoscope_core.system_events', 'DELETE');
      }).toThrow(ImmutableEventStoreError);
    });

    it('permits INSERT and SELECT on events tables', () => {
      expect(() => {
        assertEventStoreImmutability('chronoscope_core.events', 'INSERT');
        assertEventStoreImmutability('chronoscope_core.events', 'SELECT');
        assertEventStoreImmutability('chronoscope_core.system_events', 'INSERT');
        assertEventStoreImmutability('chronoscope_core.system_events', 'SELECT');
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Database Least-Privilege Role Matrix (docs/architecture/database-ownership.md)
  // ---------------------------------------------------------------------------
  describe('Database Role Separation & Least-Privilege Matrix', () => {
    describe('Role: chronoscope_app', () => {
      it('has INSERT and SELECT on events, but never UPDATE or DELETE', () => {
        expect(hasTablePrivilege('chronoscope_app', 'chronoscope_core.events', 'SELECT')).toBe(
          true,
        );
        expect(hasTablePrivilege('chronoscope_app', 'chronoscope_core.events', 'INSERT')).toBe(
          true,
        );
        expect(hasTablePrivilege('chronoscope_app', 'chronoscope_core.events', 'UPDATE')).toBe(
          false,
        );
        expect(hasTablePrivilege('chronoscope_app', 'chronoscope_core.events', 'DELETE')).toBe(
          false,
        );

        expect(() => {
          assertRolePrivilege('chronoscope_app', 'chronoscope_core.events', 'UPDATE');
        }).toThrow(PrivilegeDeniedError);
      });

      it('can write to business core and outbox, but cannot access projection checkpoints or metadata', () => {
        expect(hasTablePrivilege('chronoscope_app', 'chronoscope_core.timelines', 'UPDATE')).toBe(
          true,
        );
        expect(hasTablePrivilege('chronoscope_app', 'chronoscope_core.outbox', 'INSERT')).toBe(
          true,
        );
        expect(hasTablePrivilege('chronoscope_app', 'chronoscope_ops.inbox', 'SELECT')).toBe(false);
        expect(
          hasTablePrivilege('chronoscope_app', 'chronoscope_ops.projection_checkpoints', 'UPDATE'),
        ).toBe(false);
        expect(
          hasTablePrivilege('chronoscope_app', 'chronoscope_ops.projection_metadata', 'UPDATE'),
        ).toBe(false);
      });
    });

    describe('Role: chronoscope_projection_worker (Rule 17)', () => {
      it('has read-only access to events, aggregate state, and projection_metadata', () => {
        expect(
          hasTablePrivilege('chronoscope_projection_worker', 'chronoscope_core.events', 'SELECT'),
        ).toBe(true);
        expect(
          hasTablePrivilege('chronoscope_projection_worker', 'chronoscope_core.events', 'INSERT'),
        ).toBe(false);
        expect(
          hasTablePrivilege(
            'chronoscope_projection_worker',
            'chronoscope_core.aggregate_state',
            'SELECT',
          ),
        ).toBe(true);
        expect(
          hasTablePrivilege(
            'chronoscope_projection_worker',
            'chronoscope_core.aggregate_state',
            'UPDATE',
          ),
        ).toBe(false);
        expect(
          hasTablePrivilege(
            'chronoscope_projection_worker',
            'chronoscope_ops.projection_metadata',
            'SELECT',
          ),
        ).toBe(true);
      });

      it('enforces Rule 17 at database layer: projection worker may NEVER write projection_metadata', () => {
        expect(
          hasTablePrivilege(
            'chronoscope_projection_worker',
            'chronoscope_ops.projection_metadata',
            'UPDATE',
          ),
        ).toBe(false);
        expect(
          hasTablePrivilege(
            'chronoscope_projection_worker',
            'chronoscope_ops.projection_metadata',
            'INSERT',
          ),
        ).toBe(false);

        expect(() => {
          assertRolePrivilege(
            'chronoscope_projection_worker',
            'chronoscope_ops.projection_metadata',
            'UPDATE',
          );
        }).toThrow(PrivilegeDeniedError);
      });

      it('owns write access to inbox deduplication and projection checkpoints', () => {
        expect(
          hasTablePrivilege('chronoscope_projection_worker', 'chronoscope_ops.inbox', 'INSERT'),
        ).toBe(true);
        expect(
          hasTablePrivilege('chronoscope_projection_worker', 'chronoscope_ops.inbox', 'UPDATE'),
        ).toBe(true);
        expect(
          hasTablePrivilege(
            'chronoscope_projection_worker',
            'chronoscope_ops.projection_checkpoints',
            'UPDATE',
          ),
        ).toBe(true);
      });
    });

    describe('Role: chronoscope_rebuild_controller', () => {
      it('owns write access to projection_metadata, rebuild_runs, and cutoffs, but not inbox/checkpoints', () => {
        expect(
          hasTablePrivilege(
            'chronoscope_rebuild_controller',
            'chronoscope_ops.projection_metadata',
            'UPDATE',
          ),
        ).toBe(true);
        expect(
          hasTablePrivilege(
            'chronoscope_rebuild_controller',
            'chronoscope_ops.projection_rebuild_runs',
            'INSERT',
          ),
        ).toBe(true);
        expect(
          hasTablePrivilege(
            'chronoscope_rebuild_controller',
            'chronoscope_ops.projection_rebuild_cutoffs',
            'UPDATE',
          ),
        ).toBe(true);
        expect(
          hasTablePrivilege('chronoscope_rebuild_controller', 'chronoscope_ops.inbox', 'INSERT'),
        ).toBe(false);
        expect(
          hasTablePrivilege(
            'chronoscope_rebuild_controller',
            'chronoscope_ops.projection_checkpoints',
            'UPDATE',
          ),
        ).toBe(false);
      });
    });

    describe('Role: chronoscope_publisher', () => {
      it('has SELECT and UPDATE on outbox and job_outbox only', () => {
        expect(
          hasTablePrivilege('chronoscope_publisher', 'chronoscope_core.outbox', 'SELECT'),
        ).toBe(true);
        expect(
          hasTablePrivilege('chronoscope_publisher', 'chronoscope_core.outbox', 'UPDATE'),
        ).toBe(true);
        expect(
          hasTablePrivilege('chronoscope_publisher', 'chronoscope_ops.job_outbox', 'SELECT'),
        ).toBe(true);
        expect(
          hasTablePrivilege('chronoscope_publisher', 'chronoscope_ops.job_outbox', 'UPDATE'),
        ).toBe(true);

        // Denied all other tables
        expect(
          hasTablePrivilege('chronoscope_publisher', 'chronoscope_core.events', 'SELECT'),
        ).toBe(false);
        expect(
          hasTablePrivilege('chronoscope_publisher', 'chronoscope_core.timelines', 'SELECT'),
        ).toBe(false);
        expect(
          hasTablePrivilege(
            'chronoscope_publisher',
            'chronoscope_ops.projection_metadata',
            'SELECT',
          ),
        ).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. MongoDB Least-Privilege Rebuild Role
  // ---------------------------------------------------------------------------
  describe('MongoDB Least-Privilege Role: chronoscope_rebuild_projection', () => {
    it('restricts privileges to shadow collection, target drop, and collection rename', () => {
      const privs = MONGO_REBUILD_PROJECTION_PRIVILEGES;
      expect(privs.role).toBe('chronoscope_rebuild_projection');
      expect(privs.database).toBe('chronoscope_read');

      // Shadow collections
      expect(privs.shadowCollectionActions).toContain('find');
      expect(privs.shadowCollectionActions).toContain('insert');
      expect(privs.shadowCollectionActions).toContain('update');
      expect(privs.shadowCollectionActions).toContain('remove');
      expect(privs.shadowCollectionActions).toContain('createIndex');

      // Live target collection (for swap/drop)
      expect(privs.targetCollectionActions).toContain('find');
      expect(privs.targetCollectionActions).toContain('dropCollection');

      // Database rename operation
      expect(privs.databaseActions).toContain('renameCollectionSameDB');
    });
  });
});
