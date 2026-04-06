import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ alert_id: string }> },
) {
  const token = (await cookies()).get('uei_token')?.value;
  if (!token) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  const { alert_id } = await params;

  try {
    const resp = await fetch(`${API_URL}/alerts/${encodeURIComponent(alert_id)}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    return NextResponse.json(await resp.json(), { status: resp.status });
  } catch {
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}