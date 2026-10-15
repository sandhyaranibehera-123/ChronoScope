-- 0003_inbox.sql (plan ref: 0008_inbox.sql)
-- Phase 4: Event Inbox for read-side / projection worker deduplication.
-- Governed by system-guarantees.md Rule 8, 10.
-- Located in chronoscope_ops (Rule 10 & database-ownership.md).

CREATE TABLE IF NOT EXISTS chronoscope_ops.inbox (
  event_id CHAR(36) NOT NULL,
  consumer_name VARCHAR(64) NOT NULL,
  received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (event_id, consumer_name)
) ENGINE=InnoDB;
