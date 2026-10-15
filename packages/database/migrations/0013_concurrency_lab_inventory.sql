-- 0013_concurrency_lab_inventory.sql
-- Phase 13: Performance & Concurrency Lab - Relational Inventory Table
-- Demonstrates the 4 SQL inventory locking and race-prevention strategies:
-- 1. Uncontrolled read-modify-write (shows oversell race vulnerability)
-- 2. Pessimistic row locking (SELECT ... FOR UPDATE)
-- 3. Atomic SQL conditional update (UPDATE ... WHERE available >= ?)
-- 4. Optimistic Concurrency Control (OCC) with version counter check & retry loop
--
-- Governed by Rule 1 (MySQL sole authoritative store) & Rule 6 (Row-level locking).

CREATE TABLE IF NOT EXISTS chronoscope_ops.inventory_items (
  sku VARCHAR(64) NOT NULL,
  total_quantity INT NOT NULL,
  available_quantity INT NOT NULL,
  reserved_quantity INT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (sku)
) ENGINE=InnoDB;
