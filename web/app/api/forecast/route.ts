import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET(req: Request) {
  const token = (await cookies()).get('uei_token')?.value;
  if (!token) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const target = new URL(`${API_URL}/forecast`);
  searchParams.forEach((v, k) => target.searchParams.set(k, v));

  try {
    const resp = await fetch(target.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}
