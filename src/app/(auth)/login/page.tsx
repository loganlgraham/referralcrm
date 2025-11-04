'use client';

import { signIn } from 'next-auth/react';
import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-semibold text-center">Log in</h1>
      <button className="w-full rounded-md bg-black text-white py-2" onClick={() => signIn('google')}>
        Sign in with Google
      </button>
      <button className="w-full rounded-md border py-2" onClick={() => signIn('email')}>
        Sign in with Email
      </button>
      <p className="text-sm text-gray-600 text-center mt-4">
        New here? <Link className="underline" href="/signup">Create an account</Link>
      </p>
    </div>
  );
}
