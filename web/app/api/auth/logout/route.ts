import { NextResponse } from 'next/server';

export function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('uei_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
