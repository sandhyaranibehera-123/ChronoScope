-- 0004_projection_checkpoints.sql (plan ref: 0009_projection_checkpoints.sql)
-- Phase 4: Projection Checkpoints for Kafka offset bookkeeping in chronoscope_ops.
-- Governed by system-guarantees.md Rule 10.
-- kafka_offset stores the LAST-PROCESSED offset (highest CONTIGUOUSLY processed offset).

CREATE TABLE IF NOT EXISTS chronoscope_ops.projection_checkpoints (
  projection_name VARCHAR(64) NOT NULL,
  topic VARCHAR(128) NOT NULL,
  kafka_partition INT NOT NULL,
  kafka_offset BIGINT NOT NULL,
  last_event_id CHAR(36) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (projection_name, topic, kafka_partition)
) ENGINE=InnoDB;
