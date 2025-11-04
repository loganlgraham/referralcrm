import { getToken } from 'next-auth/jwt';
import type { Session } from 'next-auth';

export async function getCurrentSession(): Promise<Session | null> {
  const { getCurrentSession: getJwtSession } = await import('./session');
  const s = await getJwtSession();
  if (!s) return null;
  // shape into NextAuth Session minimal
  return { user: s.user, expires: '2099-01-01T00:00:00.000Z' } as Session;
}

export async function getSessionToken(req: Request) {
  const headers = Object.fromEntries(req.headers);
  return getToken({ req: { headers } as any, secret: process.env.NEXTAUTH_SECRET });
}

export type { Session } from 'next-auth';
