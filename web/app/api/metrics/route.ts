const DJANGO_URL = process.env.DJANGO_URL ?? 'http://34.130.163.154:8080';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = new URL(`${DJANGO_URL}/api/metrics`);
  searchParams.forEach((v, k) => target.searchParams.set(k, v));

  // Forward the JWT so Django can pass it along if needed.
  const headers: HeadersInit = {};
  const auth = req.headers.get('Authorization');
  if (auth) headers['Authorization'] = auth;

  try {
    const resp = await fetch(target.toString(), { cache: 'no-store', headers });
    const data = await resp.json();
    return Response.json(data, { status: resp.status });
  } catch {
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
}
