-- migrate_carbon.sql — Add tables for the Carbon Emissions Calculator
--
-- Run once against the live database:
--   docker exec -i uei-postgres psql -U uei -d uei < db/migrate_carbon.sql

-- ── carbon_config — per-node carbon intensity settings ────────────────────────
-- Devices read this via GET /carbon/config/{node_id} (no auth).
-- Admins update via PATCH /carbon/config/{node_id}.

CREATE TABLE IF NOT EXISTS carbon_config (
  node_id          TEXT            PRIMARY KEY,
  carbon_intensity DOUBLE PRECISION NOT NULL DEFAULT 400.0,  -- gCO₂ / kWh
  region           TEXT            NOT NULL DEFAULT 'global',
  updated_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Pre-populate defaults for all registered Pi nodes
INSERT INTO carbon_config (node_id) VALUES
  ('pi_bms_real'), ('pi_pv_real'),
  ('pi_bms_sim'),  ('pi_pv_sim'),
  ('pi_bms_1'),    ('pi_pv_1'),
  ('bms-node-2'),  ('bms-node-3')
ON CONFLICT (node_id) DO NOTHING;

-- ── carbon_events — one row per telemetry interval ────────────────────────────
-- Written by edge devices via POST /carbon (no auth — same pattern as /telemetry).

CREATE TABLE IF NOT EXISTS carbon_events (
  id               BIGSERIAL        PRIMARY KEY,
  ts_utc           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  node_id          TEXT             NOT NULL,
  interval_s       DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  power_kw         DOUBLE PRECISION NOT NULL DEFAULT 0,   -- total power drawn/generated (kW)
  grid_import_kw   DOUBLE PRECISION NOT NULL DEFAULT 0,   -- power from grid (kW)
  solar_gen_kw     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- solar generation (kW)
  co2_g            DOUBLE PRECISION NOT NULL DEFAULT 0,   -- CO₂ emitted this interval (g)
  co2_avoided_g    DOUBLE PRECISION NOT NULL DEFAULT 0,   -- CO₂ avoided by solar (g)
  carbon_intensity DOUBLE PRECISION NOT NULL DEFAULT 400  -- gCO₂/kWh used
);

CREATE INDEX IF NOT EXISTS idx_carbon_events_node_ts
  ON carbon_events (node_id, ts_utc DESC);
