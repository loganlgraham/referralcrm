'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthShell, AuthHeading } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const initialEmail = searchParams.get('email') ?? '';
  const isResetMode = useMemo(() => Boolean(token), [token]);

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleRequestReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      setError('Please enter your email address.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.error ?? 'Unable to start password reset. Please try again.');
        return;
      }

      setMessage('If an account exists for this email, a reset link has been sent.');
    } catch (err) {
      console.error('Failed to request password reset', err);
      setError('Unable to start password reset. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!token) {
      setError('Reset token is missing. Please request a new reset link.');
      setLoading(false);
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedEmail) {
      setError('Please enter your email address.');
      setLoading(false);
      return;
    }

    if (trimmedPassword.length < 8) {
      setError('Passwords must be at least 8 characters long.');
      setLoading(false);
      return;
    }

    if (trimmedPassword !== trimmedConfirm) {
      setError('Passwords do not match. Please check and try again.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, token, password: trimmedPassword }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.error ?? 'Unable to reset password. Please try again.');
        return;
      }

      setMessage('Your password has been updated. You can now sign in with your new password.');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Failed to reset password', err);
      setError('Unable to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      hero={{
        eyebrow: 'AFC · AHA',
        title: 'Reset your password securely.',
        description:
          'Use your Referrio account email to receive a secure reset link powered by Resend.',
      }}
    >
      <AuthHeading
        eyebrow="AFC · AHA"
        title={isResetMode ? 'Choose a new password' : 'Forgot your password?'}
        description={
          isResetMode
            ? 'Enter your email and new password to finish resetting your account.'
            : 'Enter the email associated with your account to receive a reset link.'
        }
      />

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-[hsl(var(--danger))]">
          <p className="font-medium">{error}</p>
        </div>
      )}

      {message && (
        <div className="rounded-md border border-[hsl(var(--success)/0.3)] bg-success-soft px-3 py-2 text-sm text-[hsl(var(--success))]">
          <p className="font-medium">{message}</p>
        </div>
      )}

      <form
        onSubmit={isResetMode ? handleResetPassword : handleRequestReset}
        className="space-y-4 text-left"
      >
        <Field id="email" label="Email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        {isResetMode && (
          <>
            <Field id="password" label="New password">
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="Enter a new password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            <Field id="confirmPassword" label="Confirm password">
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter your new password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
          </>
        )}

        <Button type="submit" loading={loading} size="lg" className="w-full">
          {loading
            ? isResetMode
              ? 'Updating password…'
              : 'Sending reset link…'
            : isResetMode
              ? 'Update password'
              : 'Send reset link'}
        </Button>
      </form>

      <p className="text-center text-sm text-foreground-muted">
        Remembered your password?{' '}
        <Link href="/login" className="font-medium text-primary no-underline hover:underline">
          Go back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
