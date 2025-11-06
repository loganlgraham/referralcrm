'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

const roleOptions = [
  { value: 'agent', label: 'Agent' },
  { value: 'mortgage-consultant', label: 'Mortgage Consultant' },
  { value: 'admin', label: 'Admin' },
] as const;

type Role = (typeof roleOptions)[number]['value'];

const providerErrorMessages: Record<string, string> = {
  CredentialsSignin: 'Unable to sign in with the provided credentials.',
};

function sanitizeRedirect(target: string | null, defaultPath: string) {
  if (!target) return defaultPath;

  if (target.startsWith('/')) {
    return target.startsWith('//') ? defaultPath : target;
  }

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : undefined;
    const parsed = new URL(target, base);
    if (base && parsed.origin !== base) {
      return defaultPath;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return defaultPath;
  }
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGoogle, setHasGoogle] = useState(false);
  const searchParams = useSearchParams();
  const callbackParam = searchParams.get('callbackUrl');
  const callbackUrl = useMemo(
    () => sanitizeRedirect(callbackParam, '/dashboard'),
    [callbackParam]
  );
  const providerError = searchParams.get('error');
  const displayProviderError = providerError
    ? providerErrorMessages[providerError] ?? providerError
    : null;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/providers', { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        setHasGoogle(Boolean(data?.google));
      } catch {
        setHasGoogle(false);
      }
    })();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError('Please enter an email address.');
      setLoading(false);
      return;
    }

    let redirected = false;
    try {
      const result = await signIn('credentials', {
        email: normalizedEmail,
        role,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError(result.error);
        return;
      }

      const destination = sanitizeRedirect(result?.url ?? null, callbackUrl);
      redirected = true;
      window.location.assign(destination);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error during sign in.');
    } finally {
      if (!redirected) {
        setLoading(false);
      }
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    await signIn('google', { callbackUrl: '/', redirect: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Welcome back</h1>
          <p className="text-sm text-gray-600">Sign in with the email and role assigned to your account.</p>
        </div>

        {displayProviderError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-medium">Authentication error</p>
            <p className="text-xs text-red-800">{displayProviderError}</p>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-medium">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          {hasGoogle && (
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full rounded-md bg-black px-4 py-3 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Continue with Google'}
            </button>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <span className="block text-sm font-medium text-gray-700">Role</span>
              <div className="space-y-2">
                {roleOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-3 cursor-pointer rounded-md border p-3 hover:bg-gray-50 transition-colors"
                  >
                    <input
                      type="radio"
                      name="role"
                      value={option.value}
                      checked={role === option.value}
                      onChange={() => setRole(option.value)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm font-medium">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md border border-gray-300 px-4 py-3 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Continue with Email'}
            </button>
          </form>
          {!hasGoogle && (
            <p className="text-xs text-gray-500">Google sign-in is not configured.</p>
          )}
        </div>

        <p className="text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <Link href="/signup" className="font-medium text-black underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
