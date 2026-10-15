-- 0006_command_deduplication.sql
-- Phase 5: Command Deduplication table in chronoscope_ops.
-- Governed by system-guarantees.md Rule 8 & 16:
-- "Three independent idempotency boundaries at the write side: command dedup (command_id)...
-- Commands have typed failure categories and retry classification. Command dedup stores the full outcome in MySQL."

CREATE TABLE IF NOT EXISTS chronoscope_ops.command_deduplication (
  command_id CHAR(36) NOT NULL PRIMARY KEY,
  timeline_id CHAR(36) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  success BOOLEAN NOT NULL,
  result_payload JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
