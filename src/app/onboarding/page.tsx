'use client';

export const dynamic = 'force-dynamic';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, status } = useSession();
  const selectedRole = params.get('role') || 'agent';
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  const roleAlreadySet = Boolean(session?.user?.role);

  async function saveRole() {
    setSaving(true);
    try {
      const res = await fetch('/api/me/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole }),
      });
      
      if (res.ok) {
        window.location.href = '/';
      } else {
        const error = await res.json();
        alert(error.error || 'Could not save role.');
      }
    } catch (e) {
      alert('Could not save role.');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-black mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome!</h1>
          <p className="mt-2 text-sm text-gray-600">Let's finish setting up your account</p>
        </div>

        {roleAlreadySet ? (
          <div className="space-y-4">
            <p className="text-center">
              Your account is set up as: <span className="font-semibold">{session.user.role}</span>
            </p>
            <button
              onClick={() => router.replace('/')}
              className="w-full rounded-md bg-black px-4 py-3 text-white hover:bg-gray-800"
            >
              Continue to Dashboard
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md bg-blue-50 border border-blue-200 p-4">
              <p className="text-sm text-blue-900">
                You selected: <span className="font-semibold">{selectedRole.replace('-', ' ')}</span>
              </p>
            </div>
            
            <button
              onClick={saveRole}
              disabled={saving}
              className="w-full rounded-md bg-black px-4 py-3 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Confirm and Continue'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-black"></div>
      </div>
    }>
      <OnboardingInner />
    </Suspense>
  );
}
