import { getToken } from 'next-auth/jwt';
import { headers, cookies } from 'next/headers';

export type AppSession = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role: 'admin' | 'manager' | 'mc' | 'agent' | 'viewer';
    org: 'AFC' | 'AHA';
  };
} | null;

function buildRequestFromHeaders(): Request {
  const h = new Headers();
  // copy headers and cookies into a standard Headers instance
  for (const [k, v] of headers()) h.append(k, v);
  const cookieStr = cookies().toString();
  if (cookieStr) h.set('cookie', cookieStr);
  return new Request('http://localhost', { headers: h });
}

export async function getCurrentSession(req?: Request): Promise<AppSession> {
  const token = await getToken({
    req: (req ?? (buildRequestFromHeaders() as any)) as any,
    secret: process.env.NEXTAUTH_SECRET
  });

  if (!token?.sub) return null;

  return {
    user: {
      id: token.sub,
      name: (token as any).name ?? null,
      email: (token as any).email ?? null,
      role: (token as any).role ?? 'viewer',
      org: (token as any).org ?? 'AFC'
    }
  };
}
