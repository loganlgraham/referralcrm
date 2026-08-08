'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { AuthShell, AuthHeading } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { cn } from '@/lib/cn';

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
        <AuthShell
          hero={{
            eyebrow: 'AFC · AHA',
            title: 'Create clarity for every referral partner.',
            description: "We'll have your onboarding workspace ready in just a moment.",
          }}
          wide
        >
          <AuthHeading
            eyebrow="AFC · AHA"
            title="Create your account"
            description="Preparing your signup experience…"
          />
          <div className="mx-auto h-2 w-32 animate-pulse rounded-full bg-surface-muted" />
        </AuthShell>
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

  const firstError = (key: keyof FieldErrors) => fieldErrors[key]?.[0];

  return (
    <AuthShell
      hero={{
        eyebrow: 'AFC · AHA',
        title: 'Create your Referrio workspace.',
        description:
          'Invite your teams, track referrals, and strengthen every borrower journey from a single platform.',
      }}
      wide
    >
      <AuthHeading
        eyebrow="AFC · AHA"
        title="Create your account"
        description="Tell us a few details to personalize your Referrio experience."
      />

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-[hsl(var(--danger))]" role="alert">
          <p className="font-medium">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 text-left">
        <Field id="name" label="Name" error={firstError('name')}>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Your full name"
            value={name}
            invalid={Boolean(firstError('name'))}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          id="username"
          label="Username"
          hint="Letters, numbers, hyphens, and underscores only."
          error={firstError('username')}
        >
          <Input
            id="username"
            type="text"
            autoComplete="username"
            placeholder="Choose a unique username"
            value={username}
            invalid={Boolean(firstError('username'))}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>

        <Field id="email" label="Email" error={firstError('email')}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            invalid={Boolean(firstError('email'))}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field
          id="password"
          label="Password"
          hint="Use at least 8 characters."
          error={firstError('password')}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a password"
            value={password}
            invalid={Boolean(firstError('password'))}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <div className="space-y-2">
          <span className="block text-sm font-medium text-foreground">Role</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {roleOptions.map((option) => {
              const isSelected = role === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-medium transition focus-within:outline-none focus-within:ring-2 focus-within:ring-ring/40',
                    isSelected
                      ? 'border-primary bg-primary-soft text-primary shadow-sm'
                      : 'border-border bg-surface text-foreground-muted hover:border-border-strong hover:bg-surface-muted'
                  )}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={isSelected}
                    onChange={() => setRole(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          {firstError('role') && (
            <p className="text-xs text-danger">{firstError('role')}</p>
          )}
        </div>

        {role === 'admin' && (
          <Field
            id="admin-secret"
            label="Admin signup code"
            hint="Ask an existing admin for the secret code to join as an administrator."
            error={firstError('adminSecret')}
          >
            <Input
              id="admin-secret"
              type="password"
              placeholder="Enter the admin code"
              value={adminSecret}
              invalid={Boolean(firstError('adminSecret'))}
              onChange={(event) => setAdminSecret(event.target.value)}
            />
          </Field>
        )}

        <Button type="submit" loading={loading} size="lg" className="w-full">
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="text-center text-sm text-foreground-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary no-underline hover:underline">
          Log in
        </Link>
      </p>

      <p className="text-center text-xs text-foreground-subtle">
        Need assistance?{' '}
        <a
          href={buildGmailComposeUrl('support@referralcrm.example.com')}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary no-underline hover:underline"
        >
          Contact support
        </a>
      </p>
    </AuthShell>
  );
}
