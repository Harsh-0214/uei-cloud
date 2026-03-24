import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const token = req.cookies.get('uei_token')?.value;
  const { pathname } = req.nextUrl;

  // Protect /dashboard and /users — redirect to /login if no token
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/users')) {
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  // Root path: logged in → /dashboard, not logged in → /login
  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = token ? '/dashboard' : '/login';
    return NextResponse.redirect(url);
  }

  // If already logged in, redirect /login → /dashboard
  if (pathname === '/login' && token) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/dashboard/:path*', '/users/:path*'],
};
