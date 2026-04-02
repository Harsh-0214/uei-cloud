-- migrate_pv.sql — Add pv_telemetry table for solar/PV nodes
--
-- Run once against the live database:
--   docker exec -i uei-postgres psql -U uei -d uei < db/migrate_pv.sql

CREATE TABLE IF NOT EXISTS pv_telemetry (
  id      BIGSERIAL        PRIMARY KEY,
  ts_utc  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  node_id TEXT             NOT NULL,
  pv_id   TEXT             NOT NULL,
  invr1   DOUBLE PRECISION NOT NULL DEFAULT 0,   -- inverter 1 output (A after conversion)
  invr2   DOUBLE PRECISION NOT NULL DEFAULT 0,   -- inverter 2 output (A)
  ld1     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- load channel 1 (A)
  ld2     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- load channel 2 (A)
  ld3     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- load channel 3 (A)
  ld4     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- load channel 4 (A)
  bv1     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- battery bank 1 voltage (V)
  bv2     DOUBLE PRECISION NOT NULL DEFAULT 0    -- battery bank 2 voltage (V)
);

CREATE INDEX IF NOT EXISTS idx_pv_telemetry_node_ts
  ON pv_telemetry (node_id, ts_utc DESC);
