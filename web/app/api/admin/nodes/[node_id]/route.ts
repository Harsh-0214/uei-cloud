// DELETE /api/admin/nodes/[node_id] → FastAPI DELETE /admin/nodes/{node_id}

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ node_id: string }> },
) {
  const token = (await cookies()).get('uei_token')?.value;
  if (!token) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
  const { node_id } = await params;
  try {
    const resp = await fetch(`${API_URL}/admin/nodes/${encodeURIComponent(node_id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    return NextResponse.json(await resp.json(), { status: resp.status });
  } catch {
    return NextResponse.json({ detail: 'upstream error' }, { status: 502 });
  }
}
