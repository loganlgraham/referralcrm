import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { cookies, headers } from 'next/headers';
import type { Session } from 'next-auth';
import { authOptions } from './auth-config';

type DashboardRole = 'admin' | 'manager' | 'mc' | 'agent' | 'viewer';
type DashboardOrg = 'AFC' | 'AHA';

const roleMap: Record<string, DashboardRole> = {
  admin: 'admin',
  manager: 'manager',
  mc: 'mc',
  agent: 'agent',
  viewer: 'viewer',
  'mortgage-consultant': 'mc',
};

const defaultExpiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

function mapRole(value: unknown): DashboardRole {
  if (typeof value === 'string' && value in roleMap) {
    return roleMap[value];
  }
  return 'viewer';
}

function mapOrg(value: unknown): DashboardOrg {
  return value === 'AHA' ? 'AHA' : 'AFC';
}

function enhanceSession(session: Session): Session {
  const user = session.user as Record<string, unknown> | null | undefined;
  if (!user) return session;

  const enhancedUser = {
    ...user,
    role: mapRole(user.role),
    org: mapOrg(user.org),
  } as Session['user'] & { role: DashboardRole; org: DashboardOrg };

  return { ...session, user: enhancedUser } as Session;
}

function buildRequestFromHeaders(): Request {
  const h = new Headers();
  for (const [key, value] of headers()) {
    h.append(key, value);
  }
  const cookieHeader = cookies().toString();
  if (cookieHeader) {
    h.set('cookie', cookieHeader);
  }
  return new Request('http://localhost', { headers: h });
}

export async function getCurrentSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as Record<string, unknown> | null | undefined;

  if (session && user?.id) {
    return enhanceSession(session);
  }

  const token = await getToken({
    req: buildRequestFromHeaders() as any,
    secret: authSecret,
  });

  if (!token?.sub) {
    return null;
  }

  const expInput = (token as Record<string, unknown>).exp;
  const expires = (() => {
    if (typeof expInput === 'number' && Number.isFinite(expInput)) {
      return new Date(expInput * 1000).toISOString();
    }
    if (typeof expInput === 'string') {
      const parsed = Number.parseInt(expInput, 10);
      if (Number.isFinite(parsed)) {
        return new Date(parsed * 1000).toISOString();
      }
    }
    return defaultExpiry();
  })();

  const mappedSession: Session = {
    user: {
      id: token.sub,
      name: (token as any).name ?? null,
      email: (token as any).email ?? null,
      role: mapRole((token as any).role),
      org: mapOrg((token as any).org),
    } as any,
    expires,
  };

  return mappedSession;
}

export async function getSessionToken(req: Request) {
  const headersMap = Object.fromEntries(req.headers);
  return getToken({
    req: { headers: headersMap } as any,
    secret: authSecret,
  });
}

export type { Session } from 'next-auth';
