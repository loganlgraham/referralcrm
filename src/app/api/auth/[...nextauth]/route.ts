export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest, ctx: any) {
  const { authOptions } = await import('../../../../lib/auth-config');
  return NextAuth(authOptions)(request as any, ctx as any);
}

export async function POST(request: NextRequest, ctx: any) {
  const { authOptions } = await import('../../../../lib/auth-config');
  return NextAuth(authOptions)(request as any, ctx as any);
}
