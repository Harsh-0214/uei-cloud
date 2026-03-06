const DJANGO_URL = process.env.DJANGO_URL ?? 'http://34.130.163.154:8080';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const nodeId = searchParams.get('node_id');
  const url = `${DJANGO_URL}/api/latest${nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ''}`;

  try {
    const resp = await fetch(url, { cache: 'no-store' });
    const data = await resp.json();
    return Response.json(data, { status: resp.status });
  } catch {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
}
