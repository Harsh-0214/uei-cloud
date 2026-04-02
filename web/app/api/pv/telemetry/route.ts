// GET /api/pv/telemetry → FastAPI GET /pv/telemetry
// Returns historical PV rows; supports ?node_id=, ?range=, ?limit=

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const nodeId = searchParams.get('node_id');
  const range  = searchParams.get('range')  ?? '1h';
  const limit  = searchParams.get('limit')  ?? '500';

  const url = new URL(`${API_URL}/pv/telemetry`);
  if (nodeId) url.searchParams.set('node_id', nodeId);
  url.searchParams.set('range', range);
  url.searchParams.set('limit', limit);

  try {
    const resp = await fetch(url.toString(), { cache: 'no-store' });
    return Response.json(await resp.json(), { status: resp.status });
  } catch {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
}
