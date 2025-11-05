'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

type Role = 'agent' | 'mortgage-consultant' | 'admin';

export default function SignupPage() {
  const [role, setRole] = useState<Role>('agent');
  const [loading, setLoading] = useState(false);
  
  const callbackUrl = `/onboarding?role=${encodeURIComponent(role)}`;

  const handleGoogle = async () => {
    setLoading(true);
    await signIn('google', { callbackUrl, redirect: true });
  };

  const handleEmail = async () => {
    setLoading(true);
    await signIn('email', { callbackUrl, redirect: true });
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
