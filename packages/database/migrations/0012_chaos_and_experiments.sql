-- 0012_chaos_and_experiments.sql
-- Phase 11: Chaos Engine + Experiments + Audit Logging in chronoscope_ops.
-- Governed by system-guarantees.md Rule 21 and Rule 22.

-- 1. Experiment definitions / catalog
CREATE TABLE IF NOT EXISTS chronoscope_ops.experiments (
  experiment_id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(32) NOT NULL CHECK (category IN ('CHAOS', 'CONCURRENCY', 'CONSISTENCY', 'RECOVERY', 'REPLAY')),
  description TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  steady_state_invariants JSON NOT NULL,
  fault_config JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

-- 2. Experiment run history with complete reproducibility manifests (Rule 22)
CREATE TABLE IF NOT EXISTS chronoscope_ops.experiment_runs (
  run_id CHAR(36) NOT NULL PRIMARY KEY,
  experiment_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'ABORTED')),
  manifest JSON NOT NULL,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  invariants_passed BOOLEAN NOT NULL DEFAULT FALSE,
  result_summary JSON NULL,
  error_message TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_exp_runs_exp_status (experiment_id, status)
) ENGINE=InnoDB;

-- 3. Invariants evaluated per experiment run
CREATE TABLE IF NOT EXISTS chronoscope_ops.experiment_invariants (
  invariant_id CHAR(36) NOT NULL PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  invariant_name VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('PASSED', 'FAILED', 'SKIPPED')),
  expected_value JSON NOT NULL,
  measured_value JSON NOT NULL,
  details TEXT NULL,
  evaluated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_exp_invariants_run (run_id)
) ENGINE=InnoDB;

-- 4. Audit log for all chaos fault injections, kill-switch disarms, and security events (Rule 21)
CREATE TABLE IF NOT EXISTS chronoscope_ops.audit_log (
  audit_id CHAR(36) NOT NULL PRIMARY KEY,
  actor_id VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(128) NOT NULL,
  payload JSON NULL,
  timestamp DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_audit_log_target (target_type, target_id),
  INDEX idx_audit_log_timestamp (timestamp)
) ENGINE=InnoDB;
