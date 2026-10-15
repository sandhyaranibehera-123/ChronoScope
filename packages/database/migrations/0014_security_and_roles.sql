-- 0014_security_and_roles.sql
-- Phase 14: Security & Database Role Hardening
-- Principle of Least Privilege & Multi-Layer Immutability (Rules 3, 17 & ADR-016)
--
-- Layer 1: Database-Enforced Role Separation
-- Layer 2: MySQL Trigger-Enforced Immutable Event Store (SIGNAL SQLSTATE '45000')

-- ----------------------------------------------------------------------------
-- 1. Immutable Event Store Triggers (Rule 3)
-- Rejects any UPDATE or DELETE on chronoscope_core.events regardless of DB user.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS chronoscope_core.trg_events_prevent_update;
DELIMITER $$
CREATE TRIGGER chronoscope_core.trg_events_prevent_update
BEFORE UPDATE ON chronoscope_core.events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'ImmutableEventStoreError: Updates to chronoscope_core.events are strictly forbidden by architectural rule 3';
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS chronoscope_core.trg_events_prevent_delete;
DELIMITER $$
CREATE TRIGGER chronoscope_core.trg_events_prevent_delete
BEFORE DELETE ON chronoscope_core.events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'ImmutableEventStoreError: Deletions from chronoscope_core.events are strictly forbidden by architectural rule 3';
END$$
DELIMITER ;

-- Apply same immutability triggers to chronoscope_core.system_events
DROP TRIGGER IF EXISTS chronoscope_core.trg_system_events_prevent_update;
DELIMITER $$
CREATE TRIGGER chronoscope_core.trg_system_events_prevent_update
BEFORE UPDATE ON chronoscope_core.system_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'ImmutableEventStoreError: Updates to chronoscope_core.system_events are strictly forbidden by architectural rule 3';
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS chronoscope_core.trg_system_events_prevent_delete;
DELIMITER $$
CREATE TRIGGER chronoscope_core.trg_system_events_prevent_delete
BEFORE DELETE ON chronoscope_core.system_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'ImmutableEventStoreError: Deletions from chronoscope_core.system_events are strictly forbidden by architectural rule 3';
END$$
DELIMITER ;

-- ----------------------------------------------------------------------------
-- 2. MySQL Least-Privilege Roles Provisioning
-- ----------------------------------------------------------------------------

CREATE ROLE IF NOT EXISTS
  'chronoscope_owner',
  'chronoscope_migrator',
  'chronoscope_app',
  'chronoscope_projection_worker',
  'chronoscope_rebuild_controller',
  'chronoscope_publisher';

-- chronoscope_owner: Full admin on chronoscope databases
GRANT ALL PRIVILEGES ON chronoscope_core.* TO 'chronoscope_owner';
GRANT ALL PRIVILEGES ON chronoscope_ops.* TO 'chronoscope_owner';

-- chronoscope_migrator: DDL privileges for schema migrations under GET_LOCK
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES ON chronoscope_core.* TO 'chronoscope_migrator';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES ON chronoscope_ops.* TO 'chronoscope_migrator';

-- chronoscope_app:
--   events / system_events: SELECT, INSERT only (immutable)
--   timelines, aggregate_versions, aggregate_state: SELECT, INSERT, UPDATE
--   outbox, job_outbox: INSERT only
--   timeline_position_seq: INSERT, SELECT only
--   chronoscope_ops operational tables: SELECT, INSERT, UPDATE
GRANT SELECT, INSERT ON chronoscope_core.events TO 'chronoscope_app';
GRANT SELECT, INSERT ON chronoscope_core.system_events TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_core.timelines TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_core.aggregate_versions TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_core.aggregate_state TO 'chronoscope_app';
GRANT INSERT ON chronoscope_core.outbox TO 'chronoscope_app';
GRANT INSERT, SELECT ON chronoscope_core.timeline_position_seq TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.command_deduplication TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.jobs TO 'chronoscope_app';
GRANT INSERT ON chronoscope_ops.job_outbox TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.worker_controls TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.control_commands TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.executions TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.scenario_inputs TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.experiments TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.experiment_runs TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.experiment_invariants TO 'chronoscope_app';
GRANT SELECT, INSERT ON chronoscope_ops.audit_log TO 'chronoscope_app';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.inventory_items TO 'chronoscope_app';

-- chronoscope_projection_worker:
--   events / system_events: SELECT only
--   timelines, aggregate_versions, aggregate_state: SELECT only
--   inbox, projection_checkpoints: SELECT, INSERT, UPDATE
--   projection_metadata: SELECT ONLY (Rule 17: Worker may NEVER write projection_metadata)
GRANT SELECT ON chronoscope_core.events TO 'chronoscope_projection_worker';
GRANT SELECT ON chronoscope_core.system_events TO 'chronoscope_projection_worker';
GRANT SELECT ON chronoscope_core.timelines TO 'chronoscope_projection_worker';
GRANT SELECT ON chronoscope_core.aggregate_versions TO 'chronoscope_projection_worker';
GRANT SELECT ON chronoscope_core.aggregate_state TO 'chronoscope_projection_worker';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.inbox TO 'chronoscope_projection_worker';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.projection_checkpoints TO 'chronoscope_projection_worker';
GRANT SELECT ON chronoscope_ops.projection_metadata TO 'chronoscope_projection_worker';

-- chronoscope_rebuild_controller:
--   events, timelines, aggregate_state: SELECT only
--   projection_metadata, projection_rebuild_runs, projection_rebuild_cutoffs: SELECT, INSERT, UPDATE
GRANT SELECT ON chronoscope_core.events TO 'chronoscope_rebuild_controller';
GRANT SELECT ON chronoscope_core.timelines TO 'chronoscope_rebuild_controller';
GRANT SELECT ON chronoscope_core.aggregate_state TO 'chronoscope_rebuild_controller';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.projection_metadata TO 'chronoscope_rebuild_controller';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.projection_rebuild_runs TO 'chronoscope_rebuild_controller';
GRANT SELECT, INSERT, UPDATE ON chronoscope_ops.projection_rebuild_cutoffs TO 'chronoscope_rebuild_controller';

-- chronoscope_publisher:
--   outbox, job_outbox: SELECT, UPDATE (for leasing and marking PUBLISHED)
GRANT SELECT, UPDATE ON chronoscope_core.outbox TO 'chronoscope_publisher';
GRANT SELECT, UPDATE ON chronoscope_ops.job_outbox TO 'chronoscope_publisher';
