-- migrate_algo.sql — Add tables for CAC/RDA/RHF algorithm support
--
-- Run once against the live database:
--   docker exec -i uei-postgres psql -U uei -d uei < db/migrate_algo.sql

-- ── node_config — operational profiles fetched by CAC on each Pi ─────────────
-- Admins edit these via PATCH /config/{node_id}; devices read via GET /config/{node_id}

CREATE TABLE IF NOT EXISTS node_config (
  node_id                TEXT    PRIMARY KEY,
  max_charge_current     DOUBLE PRECISION NOT NULL DEFAULT 80.0,    -- A
  max_discharge_current  DOUBLE PRECISION NOT NULL DEFAULT 120.0,   -- A
  temp_warn_threshold    DOUBLE PRECISION NOT NULL DEFAULT 45.0,    -- °C
  temp_fault_threshold   DOUBLE PRECISION NOT NULL DEFAULT 60.0,    -- °C
  soc_high_threshold     DOUBLE PRECISION NOT NULL DEFAULT 90.0,    -- %
  soc_low_threshold      DOUBLE PRECISION NOT NULL DEFAULT 20.0,    -- %
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-populate defaults for the four Pi nodes so CAC always gets a result
INSERT INTO node_config (node_id) VALUES
  ('pi_bms_real'),
  ('pi_pv_real'),
  ('pi_bms_sim'),
  ('pi_pv_sim')
ON CONFLICT (node_id) DO NOTHING;

-- ── algo_events — edge algorithm outputs (CAC, RDA) stored per packet ─────────
-- Posted by each Pi alongside its telemetry. output is JSONB so CAC and RDA
-- can each store their own schema without separate tables.

CREATE TABLE IF NOT EXISTS algo_events (
  id       BIGSERIAL   PRIMARY KEY,
  ts_utc   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  node_id  TEXT        NOT NULL,
  algo     TEXT        NOT NULL,   -- 'CAC' | 'RDA'
  output   JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_algo_events_node_algo_ts
  ON algo_events (node_id, algo, ts_utc DESC);

-- ── soh_forecast — RHF outputs (written by rhf_job.py) ───────────────────────

CREATE TABLE IF NOT EXISTS soh_forecast (
  id             SERIAL      PRIMARY KEY,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  node_id        TEXT        NOT NULL,
  bms_id         TEXT        NOT NULL,
  current_soh    DOUBLE PRECISION NOT NULL,
  forecast_30d   DOUBLE PRECISION NOT NULL,
  forecast_60d   DOUBLE PRECISION NOT NULL,
  forecast_90d   DOUBLE PRECISION NOT NULL,
  stress_summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_soh_forecast_node_ts
  ON soh_forecast (node_id, computed_at DESC);
