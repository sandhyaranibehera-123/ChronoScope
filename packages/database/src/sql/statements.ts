/**
 * Parameterized SQL statements — system-guarantees.md Rule 1:
 * "Parameterized SQL only via mysql2 (? placeholders), no ORM, no dynamic SQL identifiers
 * except through a hardcoded allowlist."
 */

export const SQL = {
  // Timelines (Rule 6, 13)
  INSERT_TIMELINE: `
    INSERT INTO chronoscope_core.timelines (
      timeline_id, parent_timeline_id, fork_position, head_position, name, description, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  SELECT_TIMELINE: `
    SELECT timeline_id, parent_timeline_id, fork_position, head_position, name, description, status, created_at, updated_at
    FROM chronoscope_core.timelines
    WHERE timeline_id = ?
  `,

  CHECK_PARENT_MAX_TIMELINE_POSITION: `
    SELECT COALESCE(MAX(timeline_position), 0) AS max_pos
    FROM chronoscope_core.events
    WHERE timeline_id = ?
  `,

  UPDATE_TIMELINE_HEAD: `
    UPDATE chronoscope_core.timelines
    SET head_position = GREATEST(head_position, ?), updated_at = CURRENT_TIMESTAMP(6)
    WHERE timeline_id = ?
  `,

  // Timeline position allocator (Rule 5, 6)
  ALLOCATE_TIMELINE_POSITION: `
    INSERT INTO chronoscope_core.timeline_position_seq () VALUES ()
  `,

  // Aggregate Versions (Rule 5, 6, 16)
  INSERT_IGNORE_AGGREGATE_VERSION: `
    INSERT IGNORE INTO chronoscope_core.aggregate_versions (
      timeline_id, aggregate_id, aggregate_type, current_sequence
    ) VALUES (?, ?, ?, 0)
  `,

  LOCK_AGGREGATE_VERSION: `
    SELECT current_sequence
    FROM chronoscope_core.aggregate_versions
    WHERE timeline_id = ? AND aggregate_id = ?
    FOR UPDATE
  `,

  UPDATE_AGGREGATE_VERSION: `
    UPDATE chronoscope_core.aggregate_versions
    SET current_sequence = ?, updated_at = CURRENT_TIMESTAMP(6)
    WHERE timeline_id = ? AND aggregate_id = ?
  `,

  // Aggregate State (Rule 9)
  SELECT_AGGREGATE_STATE: `
    SELECT timeline_id, aggregate_id, aggregate_type, aggregate_sequence, state, state_hash, updated_at
    FROM chronoscope_core.aggregate_state
    WHERE timeline_id = ? AND aggregate_id = ?
  `,

  UPSERT_AGGREGATE_STATE: `
    INSERT INTO chronoscope_core.aggregate_state (
      timeline_id, aggregate_id, aggregate_type, aggregate_sequence, state, state_hash, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
    ON DUPLICATE KEY UPDATE
      aggregate_sequence = VALUES(aggregate_sequence),
      state = VALUES(state),
      state_hash = VALUES(state_hash),
      updated_at = CURRENT_TIMESTAMP(6)
  `,

  // Events (Rule 3, 5, 6, 11)
  INSERT_EVENT: `
    INSERT INTO chronoscope_core.events (
      event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
      aggregate_sequence, event_type, schema_version, payload, event_hash,
      causation_id, correlation_id, command_id, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  SELECT_EVENTS_BY_AGGREGATE: `
    SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
           aggregate_sequence, event_type, schema_version, payload, event_hash,
           causation_id, correlation_id, command_id, recorded_at
    FROM chronoscope_core.events
    WHERE timeline_id = ? AND aggregate_id = ?
    ORDER BY aggregate_sequence ASC
  `,

  SELECT_EVENTS_BY_TIMELINE: `
    SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
           aggregate_sequence, event_type, schema_version, payload, event_hash,
           causation_id, correlation_id, command_id, recorded_at
    FROM chronoscope_core.events
    WHERE timeline_id = ?
    ORDER BY timeline_position ASC
  `,

  // Outbox (Rule 8, 10)
  INSERT_OUTBOX: `
    INSERT INTO chronoscope_core.outbox (
      outbox_id, event_id, topic, partition_key, payload, headers, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
  `,

  LEASE_OUTBOX_BATCH: `
    SELECT outbox_id, event_id, topic, partition_key, payload, attempt_count, max_attempts
    FROM chronoscope_core.outbox
    WHERE status = 'PENDING'
       OR (status = 'LEASED' AND lease_expires_at <= CURRENT_TIMESTAMP(6))
       OR (status = 'RETRY_PENDING' AND lease_expires_at <= CURRENT_TIMESTAMP(6))
    ORDER BY created_at ASC
    LIMIT ?
    FOR UPDATE SKIP LOCKED
  `,

  UPDATE_OUTBOX_LEASED: `
    UPDATE chronoscope_core.outbox
    SET status = 'LEASED',
        leased_at = CURRENT_TIMESTAMP(6),
        leased_by = ?,
        lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND),
        attempt_count = attempt_count + 1
    WHERE outbox_id = ?
  `,

  MARK_OUTBOX_PUBLISHED: `
    UPDATE chronoscope_core.outbox
    SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP(6)
    WHERE outbox_id = ?
  `,

  MARK_OUTBOX_RETRY: `
    UPDATE chronoscope_core.outbox
    SET status = 'RETRY_PENDING',
        last_error = ?,
        lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND)
    WHERE outbox_id = ?
  `,

  MARK_OUTBOX_FAILED: `
    UPDATE chronoscope_core.outbox
    SET status = 'FAILED', last_error = ?
    WHERE outbox_id = ?
  `,

  // Projections & Inbox (Rules 8, 10, 11, 17)
  INSERT_IGNORE_INBOX: `
    INSERT IGNORE INTO chronoscope_ops.inbox (
      event_id, consumer_name, received_at
    ) VALUES (?, ?, CURRENT_TIMESTAMP(6))
  `,

  CHECK_INBOX_EXISTS: `
    SELECT 1 FROM chronoscope_ops.inbox
    WHERE event_id = ? AND consumer_name = ?
  `,

  UPSERT_PROJECTION_CHECKPOINT: `
    INSERT INTO chronoscope_ops.projection_checkpoints (
      projection_name, topic, kafka_partition, kafka_offset, last_event_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
    ON DUPLICATE KEY UPDATE
      kafka_offset = VALUES(kafka_offset),
      last_event_id = VALUES(last_event_id),
      updated_at = CURRENT_TIMESTAMP(6)
  `,

  SELECT_PROJECTION_CHECKPOINT: `
    SELECT projection_name, topic, kafka_partition, kafka_offset, last_event_id, updated_at
    FROM chronoscope_ops.projection_checkpoints
    WHERE projection_name = ? AND topic = ? AND kafka_partition = ?
  `,

  SELECT_PROJECTION_STATUS: `
    SELECT status, projection_version, schema_version
    FROM chronoscope_ops.projection_metadata
    WHERE projection_name = ?
  `,

  UPDATE_PROJECTION_STATUS: `
    UPDATE chronoscope_ops.projection_metadata
    SET status = ?
    WHERE projection_name = ?
  `,

  UPDATE_PROJECTION_METADATA_REBUILD_COMPLETE: `
    UPDATE chronoscope_ops.projection_metadata
    SET status = 'ACTIVE',
        built_at = CURRENT_TIMESTAMP(6),
        source_manifest_hash = ?,
        projection_collection_hash = ?
    WHERE projection_name = ?
  `,

  // Coordination Advisory Locks (Rule 17)
  GET_ADVISORY_LOCK: `
    SELECT GET_LOCK(?, ?) AS acquired
  `,

  RELEASE_ADVISORY_LOCK: `
    SELECT RELEASE_LOCK(?) AS released
  `,

  // Command Deduplication (Rules 8, 16)
  INSERT_COMMAND_DEDUPLICATION: `
    INSERT INTO chronoscope_ops.command_deduplication (
      command_id, timeline_id, aggregate_id, success, result_payload
    ) VALUES (?, ?, ?, ?, ?)
  `,

  SELECT_COMMAND_DEDUPLICATION: `
    SELECT command_id, timeline_id, aggregate_id, success, result_payload, created_at
    FROM chronoscope_ops.command_deduplication
    WHERE command_id = ?
  `,

  // Projection Rebuild Runs & Cutoffs (Rules 11, 17)
  INSERT_PROJECTION_REBUILD_RUN: `
    INSERT INTO chronoscope_ops.projection_rebuild_runs (
      run_id, projection_name, status, started_at
    ) VALUES (?, ?, 'REBUILDING', CURRENT_TIMESTAMP(6))
  `,

  UPDATE_PROJECTION_REBUILD_RUN_STATUS: `
    UPDATE chronoscope_ops.projection_rebuild_runs
    SET status = ?,
        completed_at = CASE WHEN ? IN ('COMPLETED', 'FAILED') THEN CURRENT_TIMESTAMP(6) ELSE completed_at END,
        source_manifest_hash = COALESCE(?, source_manifest_hash),
        projection_collection_hash = COALESCE(?, projection_collection_hash),
        documents_expected = COALESCE(?, documents_expected),
        documents_written = COALESCE(?, documents_written),
        error_code = COALESCE(?, error_code)
    WHERE run_id = ?
  `,

  SELECT_PROJECTION_REBUILD_RUN: `
    SELECT run_id, projection_name, status, started_at, completed_at,
           source_manifest_hash, projection_collection_hash,
           documents_expected, documents_written, error_code
    FROM chronoscope_ops.projection_rebuild_runs
    WHERE run_id = ?
  `,

  INSERT_PROJECTION_REBUILD_CUTOFF: `
    INSERT INTO chronoscope_ops.projection_rebuild_cutoffs (
      run_id, timeline_id, aggregate_id, cutoff_sequence
    ) VALUES (?, ?, ?, ?)
  `,

  SELECT_PROJECTION_REBUILD_CUTOFFS_BY_RUN: `
    SELECT run_id, timeline_id, aggregate_id, cutoff_sequence, created_at
    FROM chronoscope_ops.projection_rebuild_cutoffs
    WHERE run_id = ?
  `,

  SELECT_ALL_AGGREGATES_FOR_TIMELINE: `
    SELECT timeline_id, aggregate_id, aggregate_type, current_sequence
    FROM chronoscope_core.aggregate_versions
    WHERE timeline_id = ?
  `,

  // Snapshots & Snapshot Sets (Rule 14 & Phase 6)
  INSERT_SNAPSHOT: `
    INSERT INTO chronoscope_core.snapshots (
      snapshot_id, set_id, timeline_id, aggregate_id, aggregate_type,
      aggregate_sequence, state_hash, status, storage_location, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
  `,

  UPDATE_SNAPSHOT_STATUS: `
    UPDATE chronoscope_core.snapshots
    SET status = ?, content_hash = COALESCE(?, content_hash)
    WHERE snapshot_id = ?
  `,

  SELECT_SNAPSHOT_BY_ID: `
    SELECT snapshot_id, set_id, timeline_id, aggregate_id, aggregate_type,
           aggregate_sequence, state_hash, status, storage_location, content_hash, created_at
    FROM chronoscope_core.snapshots
    WHERE snapshot_id = ?
  `,

  SELECT_LATEST_READY_SNAPSHOT: `
    SELECT snapshot_id, set_id, timeline_id, aggregate_id, aggregate_type,
           aggregate_sequence, state_hash, status, storage_location, content_hash, created_at
    FROM chronoscope_core.snapshots
    WHERE timeline_id = ? AND aggregate_id = ? AND status = 'READY' AND aggregate_sequence <= ?
    ORDER BY aggregate_sequence DESC
    LIMIT 1
  `,

  INSERT_SNAPSHOT_SET: `
    INSERT INTO chronoscope_core.snapshot_sets (
      set_id, timeline_id, timeline_position, status, storage_location, metadata, created_at
    ) VALUES (?, ?, ?, 'CREATING', ?, ?, CURRENT_TIMESTAMP(6))
  `,

  UPDATE_SNAPSHOT_SET_STATUS: `
    UPDATE chronoscope_core.snapshot_sets
    SET status = ?,
        content_hash = COALESCE(?, content_hash),
        completed_at = CASE WHEN ? IN ('READY', 'FAILED') THEN CURRENT_TIMESTAMP(6) ELSE completed_at END
    WHERE set_id = ?
  `,

  SELECT_SNAPSHOT_SET_BY_ID: `
    SELECT set_id, timeline_id, timeline_position, status, content_hash,
           storage_location, metadata, created_at, completed_at
    FROM chronoscope_core.snapshot_sets
    WHERE set_id = ?
  `,

  SELECT_SNAPSHOTS_BY_SET_ID: `
    SELECT snapshot_id, set_id, timeline_id, aggregate_id, aggregate_type,
           aggregate_sequence, state_hash, status, storage_location, content_hash, created_at
    FROM chronoscope_core.snapshots
    WHERE set_id = ?
  `,

  // Replay Executions (Rules 9, 11, 12, Phase 6)
  INSERT_EXECUTION: `
    INSERT INTO chronoscope_ops.executions (
      execution_id, mode, timeline_id, aggregate_id, from_sequence, to_sequence,
      snapshot_id, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', CURRENT_TIMESTAMP(6))
  `,

  UPDATE_EXECUTION: `
    UPDATE chronoscope_ops.executions
    SET status = ?,
        events_replayed = ?,
        state_hash = ?,
        live_state_hash = ?,
        hash_parity_matched = ?,
        summary = ?,
        error_message = ?,
        completed_at = CURRENT_TIMESTAMP(6)
    WHERE execution_id = ?
  `,

  SELECT_EXECUTION_BY_ID: `
    SELECT execution_id, mode, timeline_id, aggregate_id, from_sequence, to_sequence,
           snapshot_id, events_replayed, state_hash, live_state_hash, hash_parity_matched,
           status, summary, error_message, started_at, completed_at
    FROM chronoscope_ops.executions
    WHERE execution_id = ?
  `,

  // Scenario Inputs (Rule 12, 27, Phase 7)
  INSERT_SCENARIO_INPUT: `
    INSERT INTO chronoscope_ops.scenario_inputs (
      input_id, timeline_id, aggregate_id, input_type, parameters, applied, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
  `,

  SELECT_SCENARIO_INPUTS_BY_TIMELINE: `
    SELECT input_id, timeline_id, aggregate_id, input_type, parameters, applied, created_at
    FROM chronoscope_ops.scenario_inputs
    WHERE timeline_id = ?
    ORDER BY created_at ASC
  `,

  MARK_SCENARIO_INPUT_APPLIED: `
    UPDATE chronoscope_ops.scenario_inputs
    SET applied = TRUE
    WHERE input_id = ?
  `,

  // Recursive Timeline Ancestry & Effective History (Rule 13, ADR-010, Phase 7)
  SELECT_TIMELINE_ANCESTRY_RECURSIVE: `
    WITH RECURSIVE timeline_ancestry AS (
      SELECT timeline_id, parent_timeline_id, fork_position, 0 AS depth
      FROM chronoscope_core.timelines
      WHERE timeline_id = ?
      UNION ALL
      SELECT t.timeline_id, t.parent_timeline_id, t.fork_position, ta.depth + 1
      FROM chronoscope_core.timelines t
      JOIN timeline_ancestry ta ON t.timeline_id = ta.parent_timeline_id
    )
    SELECT timeline_id, parent_timeline_id, fork_position, depth
    FROM timeline_ancestry
    ORDER BY depth ASC
  `,

  SELECT_EFFECTIVE_EVENTS_RECURSIVE: `
    WITH RECURSIVE timeline_path AS (
      SELECT timeline_id, parent_timeline_id, fork_position, CAST(NULL AS UNSIGNED) AS max_allowed_position, 0 AS depth
      FROM chronoscope_core.timelines
      WHERE timeline_id = ?
      UNION ALL
      SELECT p.timeline_id, p.parent_timeline_id, p.fork_position, tp.fork_position AS max_allowed_position, tp.depth + 1
      FROM chronoscope_core.timelines p
      JOIN timeline_path tp ON p.timeline_id = tp.parent_timeline_id
    )
    SELECT e.event_id, e.timeline_id, e.timeline_position, e.aggregate_id, e.aggregate_type,
           e.aggregate_sequence, e.event_type, e.schema_version, e.payload, e.event_hash,
           e.causation_id, e.correlation_id, e.command_id, e.recorded_at
    FROM chronoscope_core.events e
    JOIN timeline_path tp ON e.timeline_id = tp.timeline_id
    WHERE (tp.max_allowed_position IS NULL OR e.timeline_position <= tp.max_allowed_position)
    ORDER BY e.timeline_position ASC
  `,

  SELECT_EFFECTIVE_EVENTS_FOR_AGGREGATE_RECURSIVE: `
    WITH RECURSIVE timeline_path AS (
      SELECT timeline_id, parent_timeline_id, fork_position, CAST(NULL AS UNSIGNED) AS max_allowed_position, 0 AS depth
      FROM chronoscope_core.timelines
      WHERE timeline_id = ?
      UNION ALL
      SELECT p.timeline_id, p.parent_timeline_id, p.fork_position, tp.fork_position AS max_allowed_position, tp.depth + 1
      FROM chronoscope_core.timelines p
      JOIN timeline_path tp ON p.timeline_id = tp.parent_timeline_id
    )
    SELECT e.event_id, e.timeline_id, e.timeline_position, e.aggregate_id, e.aggregate_type,
           e.aggregate_sequence, e.event_type, e.schema_version, e.payload, e.event_hash,
           e.causation_id, e.correlation_id, e.command_id, e.recorded_at
    FROM chronoscope_core.events e
    JOIN timeline_path tp ON e.timeline_id = tp.timeline_id
    WHERE (tp.max_allowed_position IS NULL OR e.timeline_position <= tp.max_allowed_position)
      AND e.aggregate_id = ?
    ORDER BY e.timeline_position ASC
  `,

  // Causal Graph Queries (Phase 8, Rules 5, 12, 24)
  SELECT_EVENT_BY_ID: `
    SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
           aggregate_sequence, event_type, schema_version, payload, event_hash,
           causation_id, correlation_id, command_id, recorded_at
    FROM chronoscope_core.events
    WHERE event_id = ?
  `,

  SELECT_EVENTS_BY_CORRELATION_ID: `
    SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
           aggregate_sequence, event_type, schema_version, payload, event_hash,
           causation_id, correlation_id, command_id, recorded_at
    FROM chronoscope_core.events
    WHERE correlation_id = ?
    ORDER BY timeline_position ASC
  `,

  SELECT_EVENTS_BY_CAUSATION_ID: `
    SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
           aggregate_sequence, event_type, schema_version, payload, event_hash,
           causation_id, correlation_id, command_id, recorded_at
    FROM chronoscope_core.events
    WHERE causation_id = ?
    ORDER BY timeline_position ASC
  `,

  SELECT_CAUSAL_ANCESTORS_RECURSIVE: `
    WITH RECURSIVE causal_chain AS (
      SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
             aggregate_sequence, event_type, schema_version, payload, event_hash,
             causation_id, correlation_id, command_id, recorded_at, 0 AS depth
      FROM chronoscope_core.events
      WHERE event_id = ?
      UNION ALL
      SELECT e.event_id, e.timeline_id, e.timeline_position, e.aggregate_id, e.aggregate_type,
             e.aggregate_sequence, e.event_type, e.schema_version, e.payload, e.event_hash,
             e.causation_id, e.correlation_id, e.command_id, e.recorded_at, cc.depth + 1
      FROM chronoscope_core.events e
      JOIN causal_chain cc ON e.event_id = cc.causation_id
      WHERE cc.depth < 100
    )
    SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
           aggregate_sequence, event_type, schema_version, payload, event_hash,
           causation_id, correlation_id, command_id, recorded_at, depth
    FROM causal_chain
    ORDER BY depth ASC
  `,

  SELECT_CAUSAL_DESCENDANTS_RECURSIVE: `
    WITH RECURSIVE causal_descendants AS (
      SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
             aggregate_sequence, event_type, schema_version, payload, event_hash,
             causation_id, correlation_id, command_id, recorded_at, 0 AS depth
      FROM chronoscope_core.events
      WHERE event_id = ?
      UNION ALL
      SELECT e.event_id, e.timeline_id, e.timeline_position, e.aggregate_id, e.aggregate_type,
             e.aggregate_sequence, e.event_type, e.schema_version, e.payload, e.event_hash,
             e.causation_id, e.correlation_id, e.command_id, e.recorded_at, cd.depth + 1
      FROM chronoscope_core.events e
      JOIN causal_descendants cd ON e.causation_id = cd.event_id
      WHERE cd.depth < 100
    )
    SELECT event_id, timeline_id, timeline_position, aggregate_id, aggregate_type,
           aggregate_sequence, event_type, schema_version, payload, event_hash,
           causation_id, correlation_id, command_id, recorded_at, depth
    FROM causal_descendants
    ORDER BY depth ASC
  `,

  // Jobs (Rule 8, ADR-005)
  INSERT_JOB: `
    INSERT INTO chronoscope_ops.jobs (
      job_id, job_type, idempotency_key, status, payload, max_attempts, scheduled_at
    ) VALUES (?, ?, ?, 'PENDING', ?, ?, COALESCE(?, CURRENT_TIMESTAMP(6)))
  `,

  SELECT_JOB_BY_ID: `
    SELECT job_id, job_type, idempotency_key, status, payload, result_reference,
           error_message, attempt_count, max_attempts, scheduled_at, started_at,
           completed_at, created_at, updated_at
    FROM chronoscope_ops.jobs
    WHERE job_id = ?
  `,

  SELECT_JOB_BY_IDEMPOTENCY_KEY: `
    SELECT job_id, job_type, idempotency_key, status, payload, result_reference,
           error_message, attempt_count, max_attempts, scheduled_at, started_at,
           completed_at, created_at, updated_at
    FROM chronoscope_ops.jobs
    WHERE job_type = ? AND idempotency_key = ?
  `,

  UPDATE_JOB_RUNNING: `
    UPDATE chronoscope_ops.jobs
    SET status = 'RUNNING', attempt_count = attempt_count + 1, started_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
    WHERE job_id = ? AND status IN ('PENDING', 'RETRY_PENDING')
  `,

  UPDATE_JOB_COMPLETED: `
    UPDATE chronoscope_ops.jobs
    SET status = 'COMPLETED', result_reference = ?, completed_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
    WHERE job_id = ?
  `,

  UPDATE_JOB_RETRY_PENDING: `
    UPDATE chronoscope_ops.jobs
    SET status = 'RETRY_PENDING', error_message = ?, scheduled_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND), updated_at = CURRENT_TIMESTAMP(6)
    WHERE job_id = ?
  `,

  UPDATE_JOB_FAILED: `
    UPDATE chronoscope_ops.jobs
    SET status = 'FAILED', error_message = ?, completed_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
    WHERE job_id = ?
  `,

  SELECT_JOBS_LIST: `
    SELECT job_id, job_type, idempotency_key, status, payload, result_reference,
           error_message, attempt_count, max_attempts, scheduled_at, started_at,
           completed_at, created_at, updated_at
    FROM chronoscope_ops.jobs
    ORDER BY created_at DESC
    LIMIT ?
  `,

  // Job Outbox (Rule 8, 10, ADR-005)
  INSERT_JOB_OUTBOX: `
    INSERT INTO chronoscope_ops.job_outbox (
      job_outbox_id, job_id, queue_name, payload, status, max_attempts
    ) VALUES (?, ?, ?, ?, 'PENDING', ?)
  `,

  LEASE_JOB_OUTBOX_BATCH: `
    SELECT job_outbox_id, job_id, queue_name, payload, attempt_count, max_attempts
    FROM chronoscope_ops.job_outbox
    WHERE status = 'PENDING'
       OR (status = 'LEASED' AND lease_expires_at < CURRENT_TIMESTAMP(6))
       OR (status = 'RETRY_PENDING' AND lease_expires_at < CURRENT_TIMESTAMP(6))
    ORDER BY created_at ASC
    LIMIT ?
    FOR UPDATE SKIP LOCKED
  `,

  UPDATE_JOB_OUTBOX_LEASED: `
    UPDATE chronoscope_ops.job_outbox
    SET status = 'LEASED', leased_by = ?, lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND), attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP(6)
    WHERE job_outbox_id = ?
  `,

  MARK_JOB_OUTBOX_PUBLISHED: `
    UPDATE chronoscope_ops.job_outbox
    SET status = 'PUBLISHED', updated_at = CURRENT_TIMESTAMP(6)
    WHERE job_outbox_id = ?
  `,

  MARK_JOB_OUTBOX_RETRY: `
    UPDATE chronoscope_ops.job_outbox
    SET status = 'RETRY_PENDING', error_message = ?, lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND), updated_at = CURRENT_TIMESTAMP(6)
    WHERE job_outbox_id = ?
  `,

  MARK_JOB_OUTBOX_FAILED: `
    UPDATE chronoscope_ops.job_outbox
    SET status = 'FAILED', error_message = ?, updated_at = CURRENT_TIMESTAMP(6)
    WHERE job_outbox_id = ?
  `,

  // Worker Controls (Rule 18, ADR-006: OCC-versioned desired-state)
  INSERT_WORKER_CONTROL: `
    INSERT INTO chronoscope_ops.worker_controls (
      control_target, status, concurrency, config, version, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?)
  `,

  SELECT_WORKER_CONTROL: `
    SELECT control_target, status, concurrency, config, version, updated_by, created_at, updated_at
    FROM chronoscope_ops.worker_controls
    WHERE control_target = ?
  `,

  SELECT_ALL_WORKER_CONTROLS: `
    SELECT control_target, status, concurrency, config, version, updated_by, created_at, updated_at
    FROM chronoscope_ops.worker_controls
    ORDER BY control_target ASC
  `,

  UPDATE_WORKER_CONTROL_OCC: `
    UPDATE chronoscope_ops.worker_controls
    SET status = ?, concurrency = ?, config = ?, version = version + 1, updated_by = ?
    WHERE control_target = ? AND version = ?
  `,

  // Control Commands (Rule 18, ADR-006: One-shot commands & two-phase cancellation)
  INSERT_CONTROL_COMMAND: `
    INSERT INTO chronoscope_ops.control_commands (
      command_id, command_type, target_worker, payload, status, issued_by
    ) VALUES (?, ?, ?, ?, 'PENDING', ?)
  `,

  SELECT_CONTROL_COMMAND_BY_ID: `
    SELECT command_id, command_type, target_worker, payload, status, issued_by,
           result_payload, error_message, attempt_count, acknowledged_by,
           acknowledged_at, completed_at, created_at, updated_at
    FROM chronoscope_ops.control_commands
    WHERE command_id = ?
  `,

  UPDATE_CONTROL_COMMAND_EXECUTING: `
    UPDATE chronoscope_ops.control_commands
    SET status = 'EXECUTING', acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP(6), attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP(6)
    WHERE command_id = ? AND status = 'PENDING'
  `,

  UPDATE_CONTROL_COMMAND_COMPLETED: `
    UPDATE chronoscope_ops.control_commands
    SET status = 'COMPLETED', result_payload = ?, completed_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
    WHERE command_id = ? AND status IN ('EXECUTING', 'PENDING')
  `,

  UPDATE_CONTROL_COMMAND_CANCELLATION_REQUESTED: `
    UPDATE chronoscope_ops.control_commands
    SET status = 'CANCELLATION_REQUESTED', updated_at = CURRENT_TIMESTAMP(6)
    WHERE command_id = ? AND status IN ('PENDING', 'EXECUTING')
  `,

  UPDATE_CONTROL_COMMAND_CANCELLED: `
    UPDATE chronoscope_ops.control_commands
    SET status = 'CANCELLED', error_message = ?, completed_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
    WHERE command_id = ? AND status IN ('CANCELLATION_REQUESTED', 'PENDING', 'EXECUTING')
  `,

  UPDATE_CONTROL_COMMAND_FAILED: `
    UPDATE chronoscope_ops.control_commands
    SET status = 'FAILED', error_message = ?, completed_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
    WHERE command_id = ? AND status IN ('EXECUTING', 'PENDING', 'CANCELLATION_REQUESTED')
  `,

  SELECT_PENDING_CONTROL_COMMANDS: `
    SELECT command_id, command_type, target_worker, payload, status, issued_by,
           result_payload, error_message, attempt_count, acknowledged_by,
           acknowledged_at, completed_at, created_at, updated_at
    FROM chronoscope_ops.control_commands
    WHERE status IN ('PENDING', 'CANCELLATION_REQUESTED')
    ORDER BY created_at ASC
    LIMIT ?
  `,

  SELECT_RECENT_CONTROL_COMMANDS: `
    SELECT command_id, command_type, target_worker, payload, status, issued_by,
           result_payload, error_message, attempt_count, acknowledged_by,
           acknowledged_at, completed_at, created_at, updated_at
    FROM chronoscope_ops.control_commands
    ORDER BY created_at DESC
    LIMIT ?
  `,

  // Experiments & Chaos (Rule 21, Rule 22, Phase 11)
  INSERT_EXPERIMENT: `
    INSERT INTO chronoscope_ops.experiments (
      experiment_id, name, category, description, hypothesis, steady_state_invariants, fault_config
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      category = VALUES(category),
      description = VALUES(description),
      hypothesis = VALUES(hypothesis),
      steady_state_invariants = VALUES(steady_state_invariants),
      fault_config = VALUES(fault_config),
      updated_at = CURRENT_TIMESTAMP(6)
  `,

  SELECT_EXPERIMENT_BY_ID: `
    SELECT experiment_id, name, category, description, hypothesis, steady_state_invariants, fault_config, created_at, updated_at
    FROM chronoscope_ops.experiments
    WHERE experiment_id = ?
  `,

  SELECT_ALL_EXPERIMENTS: `
    SELECT experiment_id, name, category, description, hypothesis, steady_state_invariants, fault_config, created_at, updated_at
    FROM chronoscope_ops.experiments
    ORDER BY created_at ASC
  `,

  INSERT_EXPERIMENT_RUN: `
    INSERT INTO chronoscope_ops.experiment_runs (
      run_id, experiment_id, status, manifest, started_at
    ) VALUES (?, ?, 'RUNNING', ?, CURRENT_TIMESTAMP(6))
  `,

  UPDATE_EXPERIMENT_RUN_STATUS: `
    UPDATE chronoscope_ops.experiment_runs
    SET status = ?
    WHERE run_id = ?
  `,

  UPDATE_EXPERIMENT_RUN_COMPLETED: `
    UPDATE chronoscope_ops.experiment_runs
    SET status = ?,
        completed_at = CURRENT_TIMESTAMP(6),
        invariants_passed = ?,
        result_summary = ?,
        error_message = ?
    WHERE run_id = ?
  `,

  SELECT_EXPERIMENT_RUN_BY_ID: `
    SELECT run_id, experiment_id, status, manifest, started_at, completed_at, invariants_passed, result_summary, error_message, created_at
    FROM chronoscope_ops.experiment_runs
    WHERE run_id = ?
  `,

  SELECT_RECENT_EXPERIMENT_RUNS: `
    SELECT run_id, experiment_id, status, manifest, started_at, completed_at, invariants_passed, result_summary, error_message, created_at
    FROM chronoscope_ops.experiment_runs
    ORDER BY created_at DESC
    LIMIT ?
  `,

  INSERT_EXPERIMENT_INVARIANT: `
    INSERT INTO chronoscope_ops.experiment_invariants (
      invariant_id, run_id, invariant_name, status, expected_value, measured_value, details, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
  `,

  SELECT_EXPERIMENT_INVARIANTS_BY_RUN_ID: `
    SELECT invariant_id, run_id, invariant_name, status, expected_value, measured_value, details, evaluated_at
    FROM chronoscope_ops.experiment_invariants
    WHERE run_id = ?
    ORDER BY evaluated_at ASC
  `,

  // Audit Log (Rule 21, Phase 11)
  INSERT_AUDIT_LOG: `
    INSERT INTO chronoscope_ops.audit_log (
      audit_id, actor_id, action, target_type, target_id, payload, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
  `,

  SELECT_RECENT_AUDIT_LOGS: `
    SELECT audit_id, actor_id, action, target_type, target_id, payload, timestamp
    FROM chronoscope_ops.audit_log
    ORDER BY timestamp DESC
    LIMIT ?
  `,

  SELECT_AUDIT_LOGS_BY_TARGET: `
    SELECT audit_id, actor_id, action, target_type, target_id, payload, timestamp
    FROM chronoscope_ops.audit_log
    WHERE target_type = ? AND target_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `,
} as const;
