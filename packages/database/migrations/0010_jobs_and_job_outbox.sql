-- 0010_jobs_and_job_outbox.sql
-- Phase 9: RabbitMQ + Jobs + Job_Outbox leasing in chronoscope_ops.
-- Governed by system-guarantees.md Rules 8, 10, 17 and ADR-005.

CREATE TABLE IF NOT EXISTS chronoscope_ops.jobs (
  job_id CHAR(36) NOT NULL PRIMARY KEY,
  job_type VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'RETRY_PENDING', 'FAILED')),
  payload JSON NOT NULL,
  result_reference VARCHAR(256) NULL,
  error_message TEXT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  scheduled_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_jobs_type_idempotency (job_type, idempotency_key),
  INDEX idx_jobs_status_scheduled (status, scheduled_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chronoscope_ops.job_outbox (
  job_outbox_id CHAR(36) NOT NULL PRIMARY KEY,
  job_id CHAR(36) NOT NULL,
  queue_name VARCHAR(128) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'LEASED', 'PUBLISHED', 'RETRY_PENDING', 'FAILED')),
  leased_by VARCHAR(64) NULL,
  lease_expires_at DATETIME(6) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  error_message TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_job_outbox_lease (status, lease_expires_at),
  INDEX idx_job_outbox_job_id (job_id)
) ENGINE=InnoDB;
