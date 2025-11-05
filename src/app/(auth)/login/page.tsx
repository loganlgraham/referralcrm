'use client';

import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useCallback } from 'react';

export default function LoginPage() {
  const handleGoogle = useCallback(async () => {
    try {
      const res = await signIn('google', { callbackUrl: '/' });
      if (res?.error) console.error(res.error);
    } catch (e) {
      console.error(e);
      window.location.href = '/api/auth/signin/google';
    }
  }, []);

  const handleEmail = useCallback(async () => {
    try {
      // Without an email value, NextAuth will show its email form
      const res = await signIn('email');
      if (res?.error) console.error(res.error);
    } catch (e) {
      console.error(e);
      window.location.href = '/api/auth/signin/email';
    }
  }, []);

  return (
    <div className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-semibold text-center">Log in</h1>
      <button className="w-full rounded-md bg-black text-white py-2" onClick={handleGoogle}>
        Sign in with Google
      </button>
      <button className="w-full rounded-md border py-2" onClick={handleEmail}>
        Sign in with Email
      </button>
      <p className="text-xs text-center text-gray-500">
        If nothing happens, <a className="underline" href="/api/auth/signin">open the provider list</a>.
      </p>
      <p className="text-sm text-gray-600 text-center mt-2">
        New here? <Link className="underline" href="/signup">Create an account</Link>
      </p>
    </div>
  );
}
