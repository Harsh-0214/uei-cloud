CREATE TABLE IF NOT EXISTS telemetry (
  id BIGSERIAL PRIMARY KEY,
  ts_utc TIMESTAMPTZ NOT NULL,
  node_id TEXT NOT NULL,
  bms_id TEXT NOT NULL,
  soc DOUBLE PRECISION,
  pack_voltage DOUBLE PRECISION,
  pack_current DOUBLE PRECISION,
  temp_high DOUBLE PRECISION,
  temp_low DOUBLE PRECISION,
  ccl DOUBLE PRECISION,
  dcl DOUBLE PRECISION,
  fault_active BOOLEAN,
  faults_cleared_min DOUBLE PRECISION,
  highest_cell_v DOUBLE PRECISION,
  lowest_cell_v DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_telemetry_node_ts ON telemetry(node_id, ts_utc DESC);
