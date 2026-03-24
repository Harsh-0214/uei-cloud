const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = new URL(`${API_URL}/logs`);
  for (const [k, v] of searchParams.entries()) target.searchParams.set(k, v);

  try {
    const resp = await fetch(target.toString(), { cache: 'no-store' });
    const data = await resp.json();
    return Response.json(data, { status: resp.status });
  } catch {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
}
