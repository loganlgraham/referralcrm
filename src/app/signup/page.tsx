'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const roleOptions = [
  { value: 'agent', label: 'Agent' },
  { value: 'mortgage-consultant', label: 'Mortgage Consultant' },
  { value: 'admin', label: 'Admin' },
] as const;

type Role = (typeof roleOptions)[number]['value'];

type FieldErrors = Partial<Record<'name' | 'email' | 'role' | 'adminSecret', string[]>>;

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [adminSecret, setAdminSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const router = useRouter();

  const callbackUrl = useMemo(() => `/onboarding?role=${encodeURIComponent(role)}`, [role]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          email: normalizedEmail,
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
        email: normalizedEmail,
        role,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError(result.error);
        return;
      }

      const destination = result?.url ?? callbackUrl;
      router.push(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error while creating your account.');
    } finally {
      setLoading(false);
    }
  };

  const renderFieldError = (key: keyof FieldErrors) => {
    const messages = fieldErrors[key];
    if (!messages || messages.length === 0) return null;
    return (
      <p className="text-xs text-red-600" role="alert">
        {messages[0]}
      </p>
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Create an account</h1>
          <p className="text-sm text-gray-600">Sign up with your name, email, and role to get started.</p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
              placeholder="Your full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {renderFieldError('name')}
          </div>

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
            {renderFieldError('email')}
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
            {renderFieldError('role')}
          </div>

          {role === 'admin' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700" htmlFor="admin-secret">
                Admin signup code
              </label>
              <input
                id="admin-secret"
                type="password"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                placeholder="Enter the admin code"
                value={adminSecret}
                onChange={(event) => setAdminSecret(event.target.value)}
              />
              <p className="text-xs text-gray-500">Ask an existing admin for the secret code to join as an administrator.</p>
              {renderFieldError('adminSecret')}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-black px-4 py-3 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-black underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
