'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { FormEvent, Suspense, useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

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
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const trimmedIdentifier = identifier.trim();
    const trimmedPassword = password.trim();

    if (!trimmedIdentifier) {
      setError('Please enter your username or email.');
      setLoading(false);
      return;
    }

    if (!trimmedPassword) {
      setError('Please enter your password.');
      setLoading(false);
      return;
    }

    let redirected = false;
    try {
      const result = await signIn('credentials', {
        identifier: trimmedIdentifier,
        password: trimmedPassword,
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

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 lg:flex-row">
      <div className="relative hidden w-full flex-col justify-between overflow-hidden p-12 text-white lg:flex lg:max-w-xl xl:max-w-2xl gradient-animated">
        <div className="relative z-10 space-y-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/90">AFC · AHA</p>
          <h2 className="text-4xl font-bold leading-tight xl:text-5xl">Welcome back.</h2>
        </div>
        <div className="relative z-10">
          <p className="text-sm font-semibold text-white/90">Referral CRM</p>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.15),transparent_60%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full bg-purple-500/30 blur-3xl animate-float-1" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-pink-500/30 blur-3xl animate-float-2" aria-hidden="true" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/20 blur-3xl animate-float-3" aria-hidden="true" />
      </div>
      <div className="flex w-full flex-1 flex-col items-start justify-start px-6 pb-8 pt-4 sm:px-10 sm:pb-12 sm:pt-6 lg:flex-row lg:items-center lg:justify-center lg:px-12 lg:pt-0">
        <div className="relative w-full max-w-md space-y-8 rounded-2xl bg-white/95 backdrop-blur-sm p-8 shadow-2xl ring-1 ring-black/5">
          <div className="space-y-1 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">AFC · AHA</p>
            <h1 className="text-3xl font-bold text-slate-900">Sign in</h1>
          </div>

          {displayProviderError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-medium">Authentication error</p>
              <p className="text-xs text-red-800">{displayProviderError}</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2 text-left">
                <label className="block text-sm font-medium text-slate-700" htmlFor="identifier">
                  Username or email
                </label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm shadow-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-0"
                  placeholder="yourname or you@example.com"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </div>

              <div className="space-y-2 text-left">
                <label className="block text-sm font-medium text-slate-700" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm shadow-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-0"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <div className="flex justify-end text-xs">
                  <Link href="/reset-password" className="font-medium text-slate-600 hover:text-slate-900 transition-colors">
                    Forgot password?
                  </Link>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-gradient-to-r from-purple-600 via-blue-600 to-pink-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:shadow-xl hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>

          <p className="text-center text-sm text-slate-600">
            Don't have an account?{' '}
            <Link href="/signup" className="font-semibold text-slate-900 hover:text-purple-600 transition-colors">
              Sign up
            </Link>
          </p>
        </div>
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
