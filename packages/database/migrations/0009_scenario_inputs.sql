-- =============================================================================
-- Migration 0009: Scenario Inputs for Counterfactual Execution (Phase 7)
--
-- Implements:
-- chronoscope_ops.scenario_inputs: Persisted experiment & counterfactual directives
-- (e.g. ForcePaymentFailure) recorded before domain execution (Rule 12 & Rule 27).
-- =============================================================================

CREATE TABLE IF NOT EXISTS chronoscope_ops.scenario_inputs (
  input_id CHAR(36) NOT NULL PRIMARY KEY,
  timeline_id CHAR(36) NOT NULL,
  aggregate_id CHAR(36) NULL,
  input_type VARCHAR(64) NOT NULL,
  parameters JSON NULL,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_scenario_inputs_timeline (timeline_id, applied)
) ENGINE=InnoDB;
