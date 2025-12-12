'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

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
    <div className="flex min-h-screen flex-col bg-slate-100 lg:flex-row">
      <div className="relative hidden w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-dark p-12 text-white lg:flex lg:max-w-xl xl:max-w-2xl">
        <div className="space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/80">AFC · AHA</p>
          <h2 className="text-4xl font-semibold leading-tight xl:text-5xl">Reset your password securely.</h2>
          <p className="max-w-md text-sm text-white/80">
            Use your Referral CRM account email to receive a secure reset link powered by Resend.
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
            <h1 className="text-3xl font-semibold text-slate-900">
              {isResetMode ? 'Choose a new password' : 'Forgot your password?'}
            </h1>
            <p className="text-sm text-slate-600">
              {isResetMode
                ? 'Enter your email and new password to finish resetting your account.'
                : 'Enter the email associated with your account to receive a reset link.'}
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-medium">{error}</p>
            </div>
          )}

          {message && (
            <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-900">
              <p className="font-medium">{message}</p>
            </div>
          )}

          <div className="space-y-6">
            <form onSubmit={isResetMode ? handleResetPassword : handleRequestReset} className="space-y-5">
              <div className="space-y-2 text-left">
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
              </div>

              {isResetMode && (
                <>
                  <div className="space-y-2 text-left">
                    <label className="block text-sm font-medium text-slate-700" htmlFor="password">
                      New password
                    </label>
                    <input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="Enter a new password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2 text-left">
                    <label className="block text-sm font-medium text-slate-700" htmlFor="confirmPassword">
                      Confirm password
                    </label>
                    <input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="Re-enter your new password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-brand-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-accent-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading
                  ? isResetMode
                    ? 'Updating password…'
                    : 'Sending reset link…'
                  : isResetMode
                    ? 'Update password'
                    : 'Send reset link'}
              </button>
            </form>
          </div>

          <p className="text-center text-sm text-slate-600">
            Remembered your password?{' '}
            <Link href="/login" className="font-medium text-brand-accent hover:text-brand-accent-dark">
              Go back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
