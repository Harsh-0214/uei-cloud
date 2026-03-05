import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const ALLOWED_METRICS = new Set([
  'soc', 'pack_voltage', 'pack_current',
  'temp_high', 'temp_low',
  'highest_cell_v', 'lowest_cell_v',
  'ccl', 'dcl',
]);

const ALLOWED_RANGES = new Set(['1h', '6h', '24h', '7d']);

// Only allow alphanumeric, dash, underscore in node_id to prevent SQL injection
function sanitizeId(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]/g, '');
}

type GrafanaFrame = { data: { values: number[][] } };
type GrafanaResult = { frames?: GrafanaFrame[]; error?: string };

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const metric = params.get('metric') ?? 'soc';
  const nodeId = sanitizeId(params.get('node_id') ?? 'bms-node-1');
  const range = params.get('range') ?? '1h';

  const isTemp = metric === 'temperature';
  if (!isTemp && !ALLOWED_METRICS.has(metric)) {
    return Response.json({ error: 'Invalid metric' }, { status: 400 });
  }
  if (!ALLOWED_RANGES.has(range)) {
    return Response.json({ error: 'Invalid range' }, { status: 400 });
  }

  const selectCols = isTemp ? 'temp_high, temp_low' : metric;
  const rawSql = `
    SELECT ts_utc AS time, ${selectCols}
    FROM telemetry
    WHERE node_id = '${nodeId}'
      AND $__timeFilter(ts_utc)
    ORDER BY ts_utc
    LIMIT 500
  `;

  const grafanaRes = await fetch(`${process.env.GRAFANA_URL}/api/ds/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GRAFANA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queries: [{
        datasource: { uid: process.env.GRAFANA_DATASOURCE_UID, type: 'postgres' },
        rawSql,
        format: 'time_series',
        refId: 'A',
        intervalMs: 30000,
        maxDataPoints: 500,
      }],
      from: `now-${range}`,
      to: 'now',
    }),
  });

  if (!grafanaRes.ok) {
    return Response.json({ error: 'Grafana query failed' }, { status: 502 });
  }

  const body = await grafanaRes.json();
  const result: GrafanaResult = body?.results?.A;
  const frames = result?.frames;
  if (!frames?.[0]) return Response.json([]);

  const values = frames[0].data.values;
  const timestamps: number[] = values[0];

  if (isTemp) {
    const highs: number[] = values[1];
    const lows: number[] = values[2];
    return Response.json(
      timestamps.map((t, i) => ({ time: new Date(t).toISOString(), high: highs[i], low: lows[i] }))
    );
  } else {
    const vals: number[] = values[1];
    return Response.json(
      timestamps.map((t, i) => ({ time: new Date(t).toISOString(), value: vals[i] }))
    );
  }
}
