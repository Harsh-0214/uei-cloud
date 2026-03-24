export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_URL = process.env.API_URL ?? 'http://34.130.163.154:8000';

export async function GET() {
  try {
    const resp = await fetch(`${API_URL}/stream/latest`, { cache: 'no-store' });
    return new Response(resp.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive',
      },
    });
  } catch {
    return new Response('data: {"error":"upstream unavailable"}\n\n', {
      status: 502,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
}
