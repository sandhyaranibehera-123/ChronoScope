-- 0001_databases.sql
-- Phase 1: create the two write-side MySQL databases and nothing else.
--
-- chronoscope_read is a MongoDB database (packages/read-store, Phase 4) —
-- it is never created here. MySQL has no "schema within a database" nesting
-- (CREATE SCHEMA is a literal synonym for CREATE DATABASE in MySQL), so the
-- three-way split from the design doc becomes two MySQL databases + one
-- Mongo database on a separate engine.
--
-- Event/timeline/aggregate/outbox tables are NOT created here — they belong
-- to Phase 3's migration, when domain events actually exist. A migration is
-- written in the phase whose architecture it represents.

CREATE DATABASE IF NOT EXISTS chronoscope_core;
CREATE DATABASE IF NOT EXISTS chronoscope_ops;
