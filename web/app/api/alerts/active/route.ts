import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET(req: NextRequest) {
  const token = (await cookies()).get('uei_token')?.value;
  if (!token) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const target = new URL(`${API_URL}/alerts`);
  searchParams.forEach((v, k) => target.searchParams.set(k, v));

  try {
    const resp = await fetch(target.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return NextResponse.json(await resp.json(), { status: resp.status });
  } catch {
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}