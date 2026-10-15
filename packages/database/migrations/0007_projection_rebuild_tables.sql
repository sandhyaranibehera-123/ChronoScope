-- 0007_projection_rebuild_tables.sql
-- Phase 5: Projection Rebuild audit trail & watermark cutoffs in chronoscope_ops.
-- Governed by system-guarantees.md Rule 11, 17, 24.

CREATE TABLE IF NOT EXISTS chronoscope_ops.projection_rebuild_runs (
  run_id CHAR(36) NOT NULL PRIMARY KEY,
  projection_name VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('REBUILDING','VALIDATING','SWAPPING','COMPLETED','FAILED')),
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  source_manifest_hash CHAR(64) NULL,
  projection_collection_hash CHAR(64) NULL,
  documents_expected INT NULL,
  documents_written INT NULL,
  error_code VARCHAR(64) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chronoscope_ops.projection_rebuild_cutoffs (
  run_id CHAR(36) NOT NULL,
  timeline_id CHAR(36) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  cutoff_sequence BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (run_id, timeline_id, aggregate_id)
) ENGINE=InnoDB;
