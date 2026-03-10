// Proxy POST /api/auth/login → FastAPI POST /auth/login
// Returns { access_token, token_type, org_name, role }

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resp = await fetch(`${API_URL}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      cache:   'no-store',
    });
    const data = await resp.json();
    return Response.json(data, { status: resp.status });
  } catch {
    return Response.json({ detail: 'upstream error' }, { status: 502 });
  }
}
