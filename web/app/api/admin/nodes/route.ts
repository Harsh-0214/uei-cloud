// GET  /api/admin/nodes → FastAPI GET  /admin/nodes
// POST /api/admin/nodes → FastAPI POST /admin/nodes

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

async function auth() {
  return (await cookies()).get('uei_token')?.value;
}

export async function GET() {
  const token = await auth();
  if (!token) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  try {
    const resp = await fetch(`${API_URL}/admin/nodes`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return NextResponse.json(await resp.json(), { status: resp.status });
  } catch {
    return NextResponse.json({ detail: 'upstream error' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const token = await auth();
  if (!token) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const resp = await fetch(`${API_URL}/admin/nodes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await resp.json(), { status: resp.status });
  } catch {
    return NextResponse.json({ detail: 'upstream error' }, { status: 502 });
  }
}
