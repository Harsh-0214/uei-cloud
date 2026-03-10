// Proxy GET /api/auth/me → FastAPI GET /auth/me
// Requires Authorization: Bearer <token>
// Returns { id, email, role, organization_id, org_name }

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth) {
    return Response.json({ detail: 'Not authenticated' }, { status: 401 });
  }
  try {
    const resp = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: auth },
      cache:   'no-store',
    });
    const data = await resp.json();
    return Response.json(data, { status: resp.status });
  } catch {
    return Response.json({ detail: 'upstream error' }, { status: 502 });
  }
}
