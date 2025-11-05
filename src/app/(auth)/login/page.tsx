'use client';

export const dynamic = 'force-dynamic';

import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useState } from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function ErrorAlert() {
  const params = useSearchParams();
  const error = params.get('error');
  if (!error) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      Authentication error: <b>{error}</b>. See <a className="underline" href="/api/auth/providers">available providers</a>.
    </div>
  );
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setLoading(true);
    await signIn('google', { callbackUrl: '/', redirect: true });
  };

  const handleEmail = async () => {
    setLoading(true);
    await signIn('email', { callbackUrl: '/', redirect: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome back</h1>
          <p className="mt-2 text-sm text-gray-600">Sign in to your account</p>
        </div>

        <Suspense fallback={null}>
          <ErrorAlert />
        </Suspense>

        <div className="space-y-3">
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

        <p className="text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <Link href="/signup" className="font-medium text-black underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
