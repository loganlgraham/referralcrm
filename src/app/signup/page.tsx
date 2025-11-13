'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import clsx from 'clsx';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

const roleOptions = [
  { value: 'agent', label: 'Agent' },
  { value: 'mortgage-consultant', label: 'Mortgage Consultant' },
  { value: 'admin', label: 'Admin' },
] as const;

type Role = (typeof roleOptions)[number]['value'];

type FieldErrors = Partial<Record<'name' | 'username' | 'email' | 'password' | 'role' | 'adminSecret', string[]>>;

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

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col bg-slate-100 lg:flex-row">
          <div className="relative hidden w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-dark p-12 text-white lg:flex lg:max-w-xl xl:max-w-2xl">
            <div className="space-y-6">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/80">AFC · AHA</p>
              <h2 className="text-4xl font-semibold leading-tight xl:text-5xl">Create clarity for every referral partner.</h2>
              <p className="max-w-md text-sm text-white/80">
                We'll have your onboarding workspace ready in just a moment.
              </p>
            </div>
            <div className="space-y-1 text-sm text-white/70">
              <p className="font-semibold">Referral CRM</p>
              <p>Built for the AFC &amp; AHA network.</p>
            </div>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_55%)]" aria-hidden="true" />
          </div>
          <div className="flex w-full flex-1 items-center justify-center px-6 py-12 sm:px-10 lg:px-12">
            <div className="w-full max-w-xl space-y-6 rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-black/5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">AFC · AHA</p>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold text-slate-900">Create your account</h1>
                <p className="text-sm text-slate-600">Preparing your signup experience…</p>
              </div>
              <div className="mx-auto h-2 w-32 animate-pulse rounded-full bg-slate-200" />
            </div>
          </div>
        </div>
      }
    >
      <SignupPageContent />
    </Suspense>
  );
}

function SignupPageContent() {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [adminSecret, setAdminSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const searchParams = useSearchParams();

  const callbackUrl = useMemo(() => {
    if (role === 'agent') {
      return '/profile?welcome=1';
    }
    return `/onboarding?role=${encodeURIComponent(role)}`;
  }, [role]);

  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail((previous) => (previous ? previous : emailParam));
    }
    const roleParam = searchParams.get('role');
    if (roleParam && roleOptions.some((option) => option.value === roleParam)) {
      setRole((previous) => (previous === roleParam ? previous : (roleParam as Role)));
    }
  }, [searchParams]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedPassword = password.trim();

    if (!normalizedUsername) {
      const message = 'Username is required.';
      setError(message);
      setFieldErrors({ username: [message] });
      setLoading(false);
      return;
    }

    if (!trimmedPassword || trimmedPassword.length < 8) {
      const message = 'Password must be at least 8 characters long.';
      setError(message);
      setFieldErrors({ password: [message] });
      setLoading(false);
      return;
    }

    let redirected = false;
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          username: normalizedUsername,
          email: normalizedEmail,
          password: trimmedPassword,
          role,
          adminSecret: role === 'admin' ? adminSecret.trim() || undefined : undefined,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? 'Unable to create your account. Please review the form and try again.');
        if (data?.details && typeof data.details === 'object') {
          setFieldErrors(data.details as FieldErrors);
        }
        return;
      }

      const result = await signIn('credentials', {
        identifier: normalizedEmail,
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
      setError(err instanceof Error ? err.message : 'Unexpected error while creating your account.');
    } finally {
      if (!redirected) {
        setLoading(false);
      }
    }
  };

  const renderFieldError = (key: keyof FieldErrors) => {
    const messages = fieldErrors[key];
    if (!messages || messages.length === 0) return null;
    return (
      <p className="text-xs font-medium text-red-600" role="alert">
        {messages[0]}
      </p>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 lg:flex-row">
      <div className="relative hidden w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-dark p-12 text-white lg:flex lg:max-w-xl xl:max-w-2xl">
        <div className="space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/80">AFC · AHA</p>
          <h2 className="text-4xl font-semibold leading-tight xl:text-5xl">Create your Referral CRM workspace.</h2>
          <p className="max-w-md text-sm text-white/80">
            Invite your teams, track referrals, and strengthen every borrower journey from a single platform.
          </p>
        </div>
        <div className="space-y-1 text-sm text-white/70">
          <p className="font-semibold">Referral CRM</p>
          <p>Built for the AFC &amp; AHA network.</p>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_55%)]" aria-hidden="true" />
      </div>
      <div className="flex w-full flex-1 items-center justify-center px-6 py-12 sm:px-10 lg:px-12">
        <div className="relative w-full max-w-xl space-y-8 rounded-2xl bg-white p-8 shadow-xl ring-1 ring-black/5">
          <div className="space-y-2 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">AFC · AHA</p>
            <h1 className="text-3xl font-semibold text-slate-900">Create your account</h1>
            <p className="text-sm text-slate-600">Tell us a few details to personalize your Referral CRM experience.</p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6 text-left">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                placeholder="Your full name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {renderFieldError('name')}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                placeholder="Choose a unique username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <p className="text-xs text-slate-500">Letters, numbers, hyphens, and underscores only.</p>
              {renderFieldError('username')}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              {renderFieldError('email')}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                placeholder="Create a password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-xs text-slate-500">Use at least 8 characters.</p>
              {renderFieldError('password')}
            </div>

            <div className="space-y-2">
              <span className="block text-sm font-medium text-slate-700">Role</span>
              <div className="space-y-2">
                {roleOptions.map((option) => {
                  const isSelected = role === option.value;
                  return (
                    <label
                      key={option.value}
                      className={clsx(
                        'flex items-center gap-3 rounded-lg border px-4 py-3 transition focus-within:outline-none focus-within:ring-2 focus-within:ring-brand/40',
                        isSelected
                          ? 'border-brand bg-brand/5 shadow-sm'
                          : 'border-slate-200 hover:border-brand/60 hover:bg-slate-50'
                      )}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={option.value}
                        checked={isSelected}
                        onChange={() => setRole(option.value)}
                        className="h-4 w-4 border-slate-300 text-brand focus:ring-brand"
                      />
                      <span className={clsx('text-sm font-medium', isSelected ? 'text-brand' : 'text-slate-700')}>
                        {option.label}
                      </span>
                    </label>
                  );
                })}
              </div>
              {renderFieldError('role')}
            </div>

            {role === 'admin' && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700" htmlFor="admin-secret">
                  Admin signup code
                </label>
                <input
                  id="admin-secret"
                  type="password"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                  placeholder="Enter the admin code"
                  value={adminSecret}
                  onChange={(event) => setAdminSecret(event.target.value)}
                />
                <p className="text-xs text-slate-500">Ask an existing admin for the secret code to join as an administrator.</p>
                {renderFieldError('adminSecret')}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-brand hover:text-brand-dark">
              Log in
            </Link>
          </p>

          <p className="text-center text-xs text-slate-400">
            Need assistance?{' '}
            <a href="mailto:support@referralcrm.example.com" className="font-medium text-brand hover:text-brand-dark">
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
