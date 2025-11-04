'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

type Role = 'agent' | 'mortgage-consultant' | 'admin';

export default function SignupPage() {
  const [role, setRole] = useState<Role>('agent');
  const callbackUrl = `/onboarding?role=${encodeURIComponent(role)}`;

  return (
    <div className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Create your account</h1>

      <div className="space-y-3">
        <label className="block text-sm font-medium">I am a</label>
        <div className="grid grid-cols-1 gap-2">
          {[
            { v: 'agent', label: 'Agent' },
            { v: 'mortgage-consultant', label: 'Mortgage Consultant' },
            { v: 'admin', label: 'Admin' },
          ].map((r) => (
            <label key={r.v} className="flex items-center gap-2 cursor-pointer border rounded-md p-2">
              <input
                type="radio"
                name="role"
                className="h-4 w-4"
                checked={role === (r.v as Role)}
                onChange={() => setRole(r.v as Role)}
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <button
          className="w-full rounded-md bg-black text-white py-2"
          onClick={() => signIn('google', { callbackUrl })}
        >
          Continue with Google
        </button>
        <button
          className="w-full rounded-md border py-2"
          onClick={() => signIn('email', { callbackUrl })}
        >
          Continue with Email
        </button>
      </div>

      <p className="text-sm text-gray-600">
        Already have an account? <Link className="underline" href="/login">Log in</Link>
      </p>
    </div>
  );
}
