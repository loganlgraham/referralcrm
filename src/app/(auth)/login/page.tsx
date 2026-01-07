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
    <div className="flex min-h-screen flex-col bg-slate-50 lg:flex-row">
      <div className="relative hidden w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-dark p-12 text-white lg:flex lg:max-w-xl xl:max-w-2xl">
        <div className="space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/80">AFC · AHA</p>
          <h2 className="text-4xl font-semibold leading-tight xl:text-5xl">Referral relationships, coordinated in one workspace.</h2>
          <p className="max-w-md text-sm text-white/80">
            Manage referrals, follow-ups, and lender partnerships with the tools your teams already trust.
          </p>
        </div>
        <div className="space-y-1 text-sm text-white/70">
          <p className="font-semibold">Referral CRM</p>
          <p>Built for the AFC &amp; AHA network.</p>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_55%)]" aria-hidden="true" />
      </div>
      <div className="flex w-full flex-1 flex-col items-start justify-start px-6 pb-8 pt-4 sm:px-10 sm:pb-12 sm:pt-6 lg:flex-row lg:items-center lg:justify-center lg:px-12 lg:pt-0">
        <div className="relative w-full max-w-md space-y-8 rounded-2xl bg-white p-10 shadow-sm border border-slate-200">
          <div className="space-y-2 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">AFC · AHA</p>
            <h1 className="text-3xl font-semibold text-slate-900">Sign in to Referral CRM</h1>
            <p className="text-sm text-slate-600">Use your Referral CRM credentials to sign in.</p>
          </div>

          {displayProviderError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 shadow-sm">
              <p className="font-medium">Authentication error</p>
              <p className="text-xs text-red-800">{displayProviderError}</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 shadow-sm">
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span />
                  <Link href="/reset-password" className="font-medium text-slate-800 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 hover:decoration-slate-500">
                    Forgot password?
                  </Link>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-dark hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>

          <p className="text-center text-sm text-slate-600">
            Don't have an account?{' '}
            <Link href="/signup" className="font-medium text-slate-800 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 hover:decoration-slate-500">
              Sign up
            </Link>
          </p>

          <p className="text-center text-xs text-slate-400">
            Need help?{' '}
            <a
              href="mailto:logan.graham@americanfinancing.net?subject=Referrio%20Assistance%20Needed&body=Hello%2C%0A%0AI%20need%20help%20with%20Referrio.%20Please%20assist.%0A%0AThank%20you."
              className="font-medium text-slate-800 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 hover:decoration-slate-500"
            >
              Contact support
            </a>
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
