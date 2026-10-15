-- 0011_worker_controls_and_control_commands.sql
-- Phase 10: NATS Control Plane + Durable Desired-State & Commands in chronoscope_ops.
-- Governed by system-guarantees.md Rule 18 and ADR-006.

CREATE TABLE IF NOT EXISTS chronoscope_ops.worker_controls (
  control_target VARCHAR(64) NOT NULL PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'DRAINING')),
  concurrency INT NOT NULL DEFAULT 1,
  config JSON NULL,
  version INT NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'operator',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chronoscope_ops.control_commands (
  command_id CHAR(36) NOT NULL PRIMARY KEY,
  command_type VARCHAR(64) NOT NULL,
  target_worker VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'EXECUTING', 'COMPLETED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'FAILED')),
  issued_by VARCHAR(64) NOT NULL DEFAULT 'operator',
  result_payload JSON NULL,
  error_message TEXT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  acknowledged_by VARCHAR(64) NULL,
  acknowledged_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_control_commands_status_created (status, created_at)
) ENGINE=InnoDB;
