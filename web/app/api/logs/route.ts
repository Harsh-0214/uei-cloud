const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

const RANGE_MINUTES: Record<string, number> = {
  '5m':  5,
  '15m': 15,
  '30m': 30,
  '1h':  60,
  '6h':  360,
  '24h': 1440,
  '7d':  10080,
  '30d': 43200,
  'all': Infinity,
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range    = searchParams.get('range') ?? '1h';
  const nodeId   = searchParams.get('node_id');
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '2000'), 2000);

  try {
    const logsUrl = new URL(`${API_URL}/logs`);
    if (nodeId) logsUrl.searchParams.set('node_id', nodeId);
    logsUrl.searchParams.set('range', range);
    logsUrl.searchParams.set('limit', String(limit));

    const logsResp = await fetch(logsUrl.toString(), { cache: 'no-store' });
    if (logsResp.ok) {
      const data = await logsResp.json();
      return Response.json(data);
    }
  } catch {
    // fall through to telemetry fallback
  }

  // Fallback: pull rows from /telemetry and filter by time range client-side.
  try {
    const telUrl = new URL(`${API_URL}/telemetry`);
    if (nodeId) telUrl.searchParams.set('node_id', nodeId);
    telUrl.searchParams.set('limit', String(limit));

    const resp = await fetch(telUrl.toString(), { cache: 'no-store' });
    if (!resp.ok) return Response.json({ error: 'upstream error' }, { status: resp.status });

    const rows: { ts_utc: string }[] = await resp.json();
    if (range === 'all') return Response.json(rows.slice(0, limit));

    const minutes  = RANGE_MINUTES[range] ?? 60;
    const cutoffMs = Date.now() - minutes * 60 * 1000;
    const filtered = rows.filter(r => {
      const ms = new Date(r.ts_utc.replace(' ', 'T') + 'Z').getTime();
      return ms >= cutoffMs;
    });

    return Response.json(filtered.slice(0, limit));
  } catch {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
}
