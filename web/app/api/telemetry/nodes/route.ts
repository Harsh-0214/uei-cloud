// GET /api/telemetry/nodes → FastAPI GET /telemetry/nodes
// Returns all distinct node_ids that have ever posted telemetry (no auth required)

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET() {
  try {
    const resp = await fetch(`${API_URL}/telemetry/nodes`, { cache: 'no-store' });
    const data = await resp.json();
    return Response.json(data, { status: resp.status });
  } catch {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
}
