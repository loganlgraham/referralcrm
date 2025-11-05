'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Role = 'agent' | 'mortgage-consultant' | 'admin';

type DetailedError = {
  summary: string;
  details?: Record<string, unknown>;
};

const sanitizeDetails = (details: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );

export default function SignupPage() {
  const [role, setRole] = useState<Role>('agent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DetailedError | null>(null);
  const router = useRouter();

  const callbackUrl = `/onboarding?role=${encodeURIComponent(role)}`;

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await signIn('google', { callbackUrl, redirect: false });

      if (!result) {
        console.error('Signup signIn returned no result', { provider: 'google', role, callbackUrl });
        setError({
          summary: 'No response returned from signIn. Check network availability and NextAuth configuration.',
          details: { provider: 'google', callbackUrl },
        });
        return;
      }

      if (result.error) {
        console.error('Signup signIn rejected by NextAuth', result);
        setError({
          summary: 'Sign-up request was rejected by NextAuth. Review the error details below.',
          details: sanitizeDetails({
            provider: 'google',
            role,
            callbackUrl,
            message: result.error,
            status: result.status,
            ok: result.ok,
            url: result.url,
          }),
        });
        return;
      }

      if (result.url) {
        window.location.href = result.url;
        return;
      }

      console.error('Signup signIn completed without redirect URL', result);
      setError({
        summary: 'Sign-up completed without a redirect URL. Verify the callback configuration.',
        details: sanitizeDetails({
          provider: 'google',
          role,
          callbackUrl,
          status: result.status,
          ok: result.ok,
        }),
      });
    } catch (err) {
      console.error('Signup signIn threw an unexpected error', err);
      setError({
        summary: 'Unexpected error while calling signIn. See the captured message for debugging.',
        details: sanitizeDetails({
          provider: 'google',
          role,
          callbackUrl,
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEmail = () => {
    router.push(`/auth/email?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Create an account</h1>
          <p className="mt-2 text-sm text-gray-600">Get started with your free account</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">I am a</label>
            <div className="space-y-2">
              {[
                { v: 'agent', label: 'Agent' },
                { v: 'mortgage-consultant', label: 'Mortgage Consultant' },
                { v: 'admin', label: 'Admin' },
              ].map((r) => (
                <label
                  key={r.v}
                  className="flex items-center gap-3 cursor-pointer rounded-md border p-3 hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.v}
                    checked={role === (r.v as Role)}
                    onChange={() => setRole(r.v as Role)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-medium">{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 space-y-2">
              <p className="font-medium">{error.summary}</p>
              {error.details && (
                <pre className="whitespace-pre-wrap break-words rounded bg-red-100 p-2 text-xs text-red-900">
                  {JSON.stringify(error.details, null, 2)}
                </pre>
              )}
            </div>
          )}

          <div className="space-y-3 pt-2">
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full rounded-md bg-black px-4 py-3 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Continue with Google'}
            </button>
            
            <button
              onClick={handleEmail}
              disabled={loading}
              className="w-full rounded-md border border-gray-300 px-4 py-3 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Continue with Email'}
            </button>
          </div>
        </div>

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
