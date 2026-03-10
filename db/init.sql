-- ── Telemetry (unchanged — BMS devices write here, no auth required) ────────
CREATE TABLE IF NOT EXISTS telemetry (
  id                 BIGSERIAL PRIMARY KEY,
  ts_utc             TIMESTAMPTZ NOT NULL,
  node_id            TEXT NOT NULL,
  bms_id             TEXT NOT NULL,
  soc                DOUBLE PRECISION,
  pack_voltage       DOUBLE PRECISION,
  pack_current       DOUBLE PRECISION,
  temp_high          DOUBLE PRECISION,
  temp_low           DOUBLE PRECISION,
  ccl                DOUBLE PRECISION,
  dcl                DOUBLE PRECISION,
  fault_active       BOOLEAN,
  faults_cleared_min DOUBLE PRECISION,
  highest_cell_v     DOUBLE PRECISION,
  lowest_cell_v      DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_telemetry_node_ts
  ON telemetry(node_id, ts_utc DESC);

-- ── Multi-tenant auth tables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- role: 'admin' | 'member'
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

-- Maps a node_id string (as reported by BMS devices) to an organization.
-- An admin registers node_ids here via POST /admin/nodes.
CREATE TABLE IF NOT EXISTS nodes (
  id              SERIAL PRIMARY KEY,
  node_id         TEXT NOT NULL UNIQUE,
  organization_id INT  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodes_org ON nodes(organization_id);
