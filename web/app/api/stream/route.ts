export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DJANGO_URL = process.env.DJANGO_URL ?? 'http://34.130.163.154:8080';

export async function GET() {
  const url = `${DJANGO_URL}/api/stream/latest`;
  try {
    const resp = await fetch(url, { cache: 'no-store' });
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
