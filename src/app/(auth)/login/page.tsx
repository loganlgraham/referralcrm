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
  const [googleLoading, setGoogleLoading] = useState(false);
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

  const handleGoogleSignIn = () => {
    setError(null);
    setGoogleLoading(true);
    void signIn('google', { callbackUrl }).catch((err) => {
      console.error('Failed to start Google sign-in', err);
      setError('Unable to start Google sign in. Please try again.');
      setGoogleLoading(false);
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 lg:flex-row">
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
      <div className="flex w-full flex-1 items-center justify-center px-6 py-12 sm:px-10 lg:px-12">
        <div className="relative w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl ring-1 ring-black/5">
          <div className="space-y-2 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">AFC · AHA</p>
            <h1 className="text-3xl font-semibold text-slate-900">Sign in to Referral CRM</h1>
            <p className="text-sm text-slate-600">Use your Referral CRM credentials or continue with Google.</p>
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
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                aria-hidden="true"
                focusable="false"
                className="h-5 w-5"
                viewBox="0 0 24 24"
              >
                <path
                  d="M23.52 12.273c0-.815-.073-1.6-.209-2.352H12v4.444h6.462a5.51 5.51 0 0 1-2.39 3.613v3h3.868c2.266-2.087 3.58-5.162 3.58-8.705Z"
                  fill="#4285F4"
                />
                <path
                  d="M12 24c3.24 0 5.956-1.073 7.941-2.922l-3.868-3c-1.073.72-2.45 1.147-4.073 1.147-3.13 0-5.776-2.111-6.718-4.948H1.262v3.11A12 12 0 0 0 12 24Z"
                  fill="#34A853"
                />
                <path
                  d="M5.282 14.277A7.204 7.204 0 0 1 4.9 12c0-.79.136-1.557.382-2.277V6.613H1.262A12 12 0 0 0 0 12c0 1.934.463 3.76 1.262 5.387l4.02-3.11Z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 4.754c1.762 0 3.343.606 4.586 1.796l3.434-3.434C17.952 1.212 15.236 0 12 0 7.313 0 3.273 2.688 1.262 6.613l4.02 3.11C6.224 6.866 8.87 4.754 12 4.754Z"
                  fill="#EA4335"
                />
              </svg>
              {googleLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              <span>or</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2 text-left">
                <label className="block text-sm font-medium text-slate-700" htmlFor="identifier">
                  Username or email
                </label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>

          <p className="text-center text-sm text-slate-600">
            Don't have an account?{' '}
            <Link href="/signup" className="font-medium text-brand hover:text-brand-dark">
              Sign up
            </Link>
          </p>

          <p className="text-center text-xs text-slate-400">
            Need help?{' '}
            <a href="mailto:support@referralcrm.example.com" className="font-medium text-brand hover:text-brand-dark">
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
