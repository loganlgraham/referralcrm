import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const protectedRoutes = ['/dashboard', '/referrals', '/agents', '/lenders', '/payments', '/imports', '/settings'];
const publicPrefixes = ['/api/auth', '/auth', '/api/resend/inbound', '/login', '/signup', '/email', '/check-email'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/')) || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const requiresAuth = protectedRoutes.some((route) => pathname.startsWith(route));
  if (!requiresAuth) return NextResponse.next();

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|.*\..*).*)'],
};
