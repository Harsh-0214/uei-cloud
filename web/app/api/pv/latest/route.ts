// GET /api/pv/latest → FastAPI GET /pv/latest
// Returns most recent PV reading per node (or one node if ?node_id= provided)

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const nodeId = searchParams.get('node_id');
  const url    = `${API_URL}/pv/latest${nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ''}`;
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    return Response.json(await resp.json(), { status: resp.status });
  } catch {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
}
