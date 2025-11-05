'use client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedRole = params.get('role') || 'agent';
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        if (!mounted) return;
        if (!data?.user) {
          router.replace('/login');
          return;
        }
        setSession(data);
      } catch (e) {
        router.replace('/login');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  const roleAlreadySet = Boolean(session?.user?.role);

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

  if (loading) return null;

  return (
    <div className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      {roleAlreadySet ? (
        <>
          <p>Your role is already set to {session?.user?.role}.</p>
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

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingInner />
    </Suspense>
  );
}
