-- 0002_event_store.sql
-- Phase 3: Core Event Sourcing, Dual-Sequencing, OCC, Aggregate State, and Transactional Outbox.
--
-- Governed by system-guarantees.md rules 3, 5, 6, 8, 9, 10, 16.
-- Sole authoritative store: MySQL chronoscope_core (Rule 1).

-- ----------------------------------------------------------------------------
-- 1. Timelines table (Rule 6, 13)
-- DAG hierarchy of execution timelines. Branches fork from a parent timeline at fork_position.
-- head_position is a best-effort cached high-water mark, authoritative value is COALESCE(MAX(events.timeline_position), 0).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chronoscope_core.timelines (
  timeline_id CHAR(36) NOT NULL,
  parent_timeline_id CHAR(36) NULL,
  fork_position BIGINT NOT NULL DEFAULT 0,
  head_position BIGINT NOT NULL DEFAULT 0,
  name VARCHAR(64) NOT NULL,
  description TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED', 'DELETED')),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (timeline_id),
  CONSTRAINT fk_timelines_parent FOREIGN KEY (parent_timeline_id) REFERENCES chronoscope_core.timelines (timeline_id)
) ENGINE=InnoDB;

-- Seed default root timeline 'MAIN' if not already present
INSERT IGNORE INTO chronoscope_core.timelines (
  timeline_id,
  parent_timeline_id,
  fork_position,
  head_position,
  name,
  description,
  status
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  NULL,
  0,
  0,
  'MAIN',
  'Root timeline for authoritative mainline execution',
  'ACTIVE'
);

-- ----------------------------------------------------------------------------
-- 2. Timeline position sequence table (Rule 5, 6)
-- Global allocator for logical timeline_position ordering.
-- Uses AUTO_INCREMENT table pattern under innodb_autoinc_lock_mode = 2.
-- Gaps are expected. Logical ordering key, not causal order (Rule 5).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chronoscope_core.timeline_position_seq (
  position BIGINT NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (position)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- 3. Aggregate versions table (Rule 5, 6, 16)
-- Row-level lock anchor for optimistic concurrency control (OCC).
-- current_sequence is derived strictly from this row, NEVER AUTO_INCREMENT.
-- Event appends lock ONLY this row (SELECT ... FOR UPDATE), never a timeline-wide lock.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chronoscope_core.aggregate_versions (
  timeline_id CHAR(36) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  current_sequence BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (timeline_id, aggregate_id),
  KEY idx_aggregate_versions_type (aggregate_type),
  CONSTRAINT fk_aggregate_versions_timeline FOREIGN KEY (timeline_id) REFERENCES chronoscope_core.timelines (timeline_id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- 4. Aggregate state table (Rule 9)
-- Incrementally maintained materialization of current state, updated in the SAME
-- transaction as the event append.
-- Live hash = aggregate_state.state_hash.
-- Three-way invariant: aggregate_versions.current_sequence == aggregate_state.aggregate_sequence == MAX(events.aggregate_sequence).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chronoscope_core.aggregate_state (
  timeline_id CHAR(36) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_sequence BIGINT NOT NULL,
  state JSON NOT NULL,
  state_hash CHAR(64) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (timeline_id, aggregate_id),
  KEY idx_aggregate_state_type (aggregate_type),
  CONSTRAINT fk_aggregate_state_timeline FOREIGN KEY (timeline_id) REFERENCES chronoscope_core.timelines (timeline_id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- 5. Domain events table (Rule 3, 4, 5, 6, 9, 11)
-- Append-only, immutable domain events.
-- Dual-sequencing:
--   - timeline_position: logical timeline order (seq allocator)
--   - aggregate_sequence: contiguous sequence per aggregate (OCC)
-- Both UNIQUE KEYs are explicitly named for ER_DUP_ENTRY disambiguation (Rule 5).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chronoscope_core.events (
  event_id CHAR(36) NOT NULL,
  timeline_id CHAR(36) NOT NULL,
  timeline_position BIGINT NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_sequence BIGINT NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  payload JSON NOT NULL,
  event_hash CHAR(64) NOT NULL,
  causation_id CHAR(36) NULL,
  correlation_id CHAR(36) NOT NULL,
  command_id CHAR(36) NULL,
  recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_events_timeline_position (timeline_id, timeline_position),
  UNIQUE KEY uq_events_aggregate_sequence (timeline_id, aggregate_id, aggregate_sequence),
  KEY idx_events_timeline_pos (timeline_id, timeline_position),
  KEY idx_events_aggregate (timeline_id, aggregate_id, aggregate_sequence),
  KEY idx_events_causation (causation_id),
  KEY idx_events_correlation (correlation_id),
  KEY idx_events_command (command_id),
  KEY idx_events_type (event_type),
  CONSTRAINT fk_events_timeline FOREIGN KEY (timeline_id) REFERENCES chronoscope_core.timelines (timeline_id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- 6. System events table (Rule 3)
-- Operational/diagnostic events physically separated from domain events.
-- Only domain events carry replay-determinism guarantees.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chronoscope_core.system_events (
  event_id CHAR(36) NOT NULL,
  timeline_id CHAR(36) NULL,
  event_type VARCHAR(128) NOT NULL,
  payload JSON NOT NULL,
  recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (event_id),
  KEY idx_system_events_type (event_type),
  KEY idx_system_events_recorded (recorded_at)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------------------
-- 7. Transactional outbox table (Rule 8, 10)
-- Reliable message publishing to Kafka via outbox pattern.
-- Written in the SAME transaction as event append.
-- Partition key is strictly `${timelineId}:${aggregateId}`.
-- Leased by outbox publishers via SELECT ... FOR UPDATE SKIP LOCKED.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chronoscope_core.outbox (
  outbox_id CHAR(36) NOT NULL,
  event_id CHAR(36) NOT NULL,
  topic VARCHAR(128) NOT NULL,
  partition_key VARCHAR(128) NOT NULL,
  payload JSON NOT NULL,
  headers JSON NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'LEASED', 'PUBLISHED', 'FAILED', 'RETRY_PENDING')),
  leased_at DATETIME(6) NULL,
  leased_by VARCHAR(64) NULL,
  lease_expires_at DATETIME(6) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  published_at DATETIME(6) NULL,
  PRIMARY KEY (outbox_id),
  UNIQUE KEY uq_outbox_event (event_id),
  KEY idx_outbox_leasing (status, lease_expires_at, created_at),
  CONSTRAINT fk_outbox_event FOREIGN KEY (event_id) REFERENCES chronoscope_core.events (event_id)
) ENGINE=InnoDB;
