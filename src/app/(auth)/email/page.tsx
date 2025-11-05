'use client';

import { signIn } from 'next-auth/react';
import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function EmailSignInForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn('email', {
      email,
      redirect: false,
      callbackUrl,
    });

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else if (result?.url) {
      // Redirect to a page telling the user to check their email
      window.location.href = result.url;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          Error: {error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="w-full rounded-md border border-gray-300 px-4 py-3"
          disabled={loading}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-black px-4 py-3 text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? 'Sending link...' : 'Send Sign-In Link'}
      </button>
    </form>
  );
}

export default function EmailSignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Continue with Email</h1>
          <p className="mt-2 text-sm text-gray-600">
            Enter your email to receive a sign-in link.
          </p>
        </div>

        {/* Google sign-in option */}
        <div className="space-y-3">
          <button
            onClick={() => signIn('google', { callbackUrl: '/', redirect: true })}
            className="w-full rounded-md bg-black px-4 py-3 text-white hover:bg-gray-800"
          >
            Continue with Google
          </button>
        </div>

        <Suspense fallback={<div className="h-40 w-full animate-pulse bg-gray-100 rounded-md"></div>}>
          <EmailSignInForm />
        </Suspense>
        
        <p className="text-center text-sm text-gray-600">
          <Link href="/login" className="font-medium text-black underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
