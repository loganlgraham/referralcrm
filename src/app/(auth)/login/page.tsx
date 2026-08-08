'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { FormEvent, Suspense, useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { AuthShell, AuthHeading } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

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
    <AuthShell>
      <AuthHeading title="Sign in" />

      {displayProviderError && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-[hsl(var(--danger))]">
          <p className="font-medium">Authentication error</p>
          <p className="text-xs">{displayProviderError}</p>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-[hsl(var(--danger))]">
          <p className="font-medium">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        <Field id="identifier" label="Username or email">
          <Input
            id="identifier"
            type="text"
            autoComplete="username"
            placeholder="yourname or you@example.com"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </Field>

        <Field
          id="password"
          label="Password"
          hint={
            <span className="flex justify-end">
              <Link
                href="/reset-password"
                className="text-sm font-medium text-primary no-underline hover:underline"
              >
                Forgot password?
              </Link>
            </span>
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="text-center text-sm text-foreground-muted">
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          className="font-medium text-primary no-underline hover:underline"
        >
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
