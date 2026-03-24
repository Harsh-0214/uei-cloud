// Proxy GET /api/admin/users → FastAPI GET /admin/users
// Returns all users with their org_name

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET() {
  const token = (await cookies()).get('uei_token')?.value;
  if (!token) {
    return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  }
  try {
    const resp = await fetch(`${API_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ detail: 'upstream error' }, { status: 502 });
  }
}
