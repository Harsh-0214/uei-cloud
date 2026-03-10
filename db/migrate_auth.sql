-- Run this against an existing database to add multi-tenant auth tables.
-- Safe to run multiple times (all statements use IF NOT EXISTS).
--
-- Usage:
--   psql postgresql://uei:uei_password@34.130.163.154:5432/uei -f db/migrate_auth.sql
-- Or inside the postgres container:
--   docker exec -i uei-postgres psql -U uei -d uei < db/migrate_auth.sql

CREATE TABLE IF NOT EXISTS organizations (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  hashed_password TEXT NOT NULL,
  organization_id INT  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_org   ON users(organization_id);

CREATE TABLE IF NOT EXISTS nodes (
  id              SERIAL PRIMARY KEY,
  node_id         TEXT NOT NULL UNIQUE,
  organization_id INT  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodes_org ON nodes(organization_id);
