// Proxy POST /api/auth/register → FastAPI POST /auth/register
// Body: { email, password, org_name }
// Returns { access_token, token_type, org_name, role }

import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resp = await fetch(`${API_URL}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      cache:   'no-store',
    });
    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json(data, { status: resp.status });
    }

    const res = NextResponse.json(data, { status: 201 });
    res.cookies.set('uei_token', data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8, // 8 hours
    });
    return res;
  } catch {
    return NextResponse.json({ detail: 'upstream error' }, { status: 502 });
  }
}
