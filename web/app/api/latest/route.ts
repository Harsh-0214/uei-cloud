import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const nodeId = req.nextUrl.searchParams.get('node_id');
  const url = nodeId
    ? `${process.env.API_URL}/latest?node_id=${encodeURIComponent(nodeId)}`
    : `${process.env.API_URL}/latest`;

  const res = await fetch(url);
  if (!res.ok) {
    return Response.json({ error: 'Failed to fetch from API' }, { status: res.status });
  }
  return Response.json(await res.json());
}
