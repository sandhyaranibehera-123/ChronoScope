#!/bin/bash
# Runs once, automatically, on first container boot (docker-entrypoint-initdb.d),
# as root, with the container's own environment already available.
#
# Creates chronoscope_migrator with DDL + broad DML rights (needed because it
# CREATEs the databases in the first place) but NOT full superuser/GRANT
# OPTION. This is a Phase 1 simplification: the full least-privilege role
# matrix (chronoscope_app / chronoscope_projection_worker /
# chronoscope_rebuild_controller / chronoscope_publisher / chronoscope_owner)
# is provisioned in Phase 14 — see docs/architecture/database-ownership.md.
set -euo pipefail

: "${MYSQL_MIGRATOR_USER:=chronoscope_migrator}"
: "${MYSQL_MIGRATOR_PASSWORD:=chronoscope_migrator_secret}"

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
  CREATE USER IF NOT EXISTS '${MYSQL_MIGRATOR_USER}'@'%' IDENTIFIED BY '${MYSQL_MIGRATOR_PASSWORD}';
  GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, CREATE VIEW,
        SELECT, INSERT, UPDATE, DELETE, LOCK TABLES
    ON *.* TO '${MYSQL_MIGRATOR_USER}'@'%';
  FLUSH PRIVILEGES;
EOSQL

echo "Created MySQL user '${MYSQL_MIGRATOR_USER}' for migrations."
