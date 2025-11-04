'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const selectedRole = params.get('role') || 'agent';
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  const roleAlreadySet = Boolean((session?.user as any)?.role);

  async function saveRole() {
    setSaving(true);
    const res = await fetch('/api/me/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: selectedRole }),
    });
    setSaving(false);
    if (res.ok) {
      router.replace('/');
    } else {
      alert('Could not save role.');
    }
  }

  if (status === 'loading') return null;
  if (!session) return null;

  return (
    <div className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      {roleAlreadySet ? (
        <>
          <p>Your role is already set to {(session.user as any).role}.</p>
          <button className="rounded-md bg-black text-white py-2 px-4" onClick={() => router.replace('/')}>Continue</button>
        </>
      ) : (
        <>
          <p>We’ll finish setting up your account with the role: <b>{selectedRole}</b></p>
          <button
            disabled={saving}
            className="rounded-md bg-black text-white py-2 px-4 disabled:opacity-60"
            onClick={saveRole}
          >
            {saving ? 'Saving…' : 'Confirm and continue'}
          </button>
        </>
      )}
    </div>
  );
}
