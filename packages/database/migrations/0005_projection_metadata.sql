-- 0005_projection_metadata.sql (plan ref: 0010_projection_metadata.sql)
-- Phase 4: Projection Metadata in chronoscope_ops for status gating and collection-level hash tracking.
-- Governed by system-guarantees.md Rule 11, 17.

CREATE TABLE IF NOT EXISTS chronoscope_ops.projection_metadata (
  projection_name VARCHAR(64) NOT NULL PRIMARY KEY,
  projection_version INT NOT NULL,
  schema_version INT NOT NULL,
  target_store VARCHAR(16) NOT NULL DEFAULT 'mongodb',
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REBUILDING','VALIDATING','SWAPPING','FAILED')),
  built_at DATETIME(6) NULL,
  source_manifest_hash CHAR(64) NULL,
  projection_collection_hash CHAR(64) NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO chronoscope_ops.projection_metadata (
  projection_name,
  projection_version,
  schema_version,
  target_store,
  status
) VALUES
  ('order_summary', 1, 1, 'mongodb', 'ACTIVE'),
  ('payment_summary', 1, 1, 'mongodb', 'ACTIVE'),
  ('shipment_summary', 1, 1, 'mongodb', 'ACTIVE');
