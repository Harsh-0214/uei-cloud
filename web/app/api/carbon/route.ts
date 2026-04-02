import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('uei_token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const params = new URLSearchParams();
  if (searchParams.get('node_id')) params.set('node_id', searchParams.get('node_id')!);
  if (searchParams.get('range'))   params.set('range',   searchParams.get('range')!);

  const upstream = await fetch(`${API_URL}/carbon/summary?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
