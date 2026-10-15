-- =============================================================================
-- Migration 0008: Snapshots and Replay Executions (Phase 6)
--
-- Implements:
-- 1. chronoscope_core.snapshot_sets: Timeline-level consistent cuts (Rule 14)
-- 2. chronoscope_core.snapshots: Per-aggregate point-in-time snapshots (Rule 14, ADR-009)
-- 3. chronoscope_ops.executions: Permanent replay run audit & hash parity records (Rule 9, 11)
-- =============================================================================

CREATE TABLE IF NOT EXISTS chronoscope_core.snapshot_sets (
  set_id CHAR(36) NOT NULL PRIMARY KEY,
  timeline_id CHAR(36) NOT NULL,
  timeline_position BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CREATING' CHECK (status IN ('CREATING', 'READY', 'FAILED')),
  content_hash CHAR(64) NULL,
  storage_location VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  INDEX idx_snapshot_sets_timeline (timeline_id, timeline_position)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chronoscope_core.snapshots (
  snapshot_id CHAR(36) NOT NULL PRIMARY KEY,
  set_id CHAR(36) NULL,
  timeline_id CHAR(36) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_sequence BIGINT NOT NULL,
  state_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CREATING' CHECK (status IN ('CREATING', 'READY', 'FAILED')),
  storage_location VARCHAR(255) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_snapshots_aggregate_seq (timeline_id, aggregate_id, aggregate_sequence),
  INDEX idx_snapshots_set (set_id),
  INDEX idx_snapshots_aggregate (timeline_id, aggregate_id, aggregate_sequence DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chronoscope_ops.executions (
  execution_id CHAR(36) NOT NULL PRIMARY KEY,
  mode VARCHAR(32) NOT NULL CHECK (mode IN ('LIVE_REPLAY', 'COUNTERFACTUAL_REPLAY')),
  timeline_id CHAR(36) NOT NULL,
  aggregate_id CHAR(36) NULL,
  from_sequence BIGINT NOT NULL DEFAULT 0,
  to_sequence BIGINT NULL,
  snapshot_id CHAR(36) NULL,
  events_replayed INT NOT NULL DEFAULT 0,
  state_hash CHAR(64) NULL,
  live_state_hash CHAR(64) NULL,
  hash_parity_matched BOOLEAN NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  summary JSON NULL,
  error_message TEXT NULL,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  INDEX idx_executions_timeline_agg (timeline_id, aggregate_id, started_at)
) ENGINE=InnoDB;
