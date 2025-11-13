'use client';

export const dynamic = 'force-dynamic';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';

const roleOptions = [
  {
    value: 'agent',
    label: 'Agent',
    description: 'Track referrals and stay on top of every borrower hand-off.',
  },
  {
    value: 'mortgage-consultant',
    label: 'Mortgage Consultant',
    description: 'Coordinate with agents and manage lender relationships.',
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Oversee teams, reporting, and org-wide configuration.',
  },
] as const;

type RoleOption = (typeof roleOptions)[number]['value'];

function getRoleDestination(role: RoleOption | string | undefined | null) {
  if (role === 'agent') {
    return '/profile?welcome=1';
  }
  return '/dashboard';
}

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, status } = useSession();
  const roleFromQuery = params.get('role');
  const initialRole = useMemo<RoleOption>(() => {
    if (roleFromQuery && roleOptions.some((option) => option.value === roleFromQuery)) {
      return roleFromQuery as RoleOption;
    }
    return 'agent';
  }, [roleFromQuery]);
  const [saving, setSaving] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleOption>(initialRole);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  useEffect(() => {
    setSelectedRole(initialRole);
  }, [initialRole]);

  const mappedRole = session?.user?.role;
  const roleAlreadySet = Boolean(mappedRole && mappedRole !== 'viewer');

  useEffect(() => {
    if (!roleAlreadySet || !mappedRole) return;
    setRedirecting(true);
    const destination = getRoleDestination(mappedRole);
    router.replace(destination);
  }, [mappedRole, roleAlreadySet, router]);

  async function saveRole() {
    if (!selectedRole) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/me/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole }),
      });

      if (res.ok) {
        setRedirecting(true);
        const destination = getRoleDestination(selectedRole);
        window.location.href = destination;
        return;
      } else {
        const error = await res.json();
        setError(error.error || 'Could not save role.');
      }
    } catch (e) {
      setError('Could not save role.');
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

  if (redirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-black"></div>
          <p className="mt-4 text-gray-600">Redirecting you to your workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome!</h1>
          <p className="mt-2 text-sm text-gray-600">Let's finish setting up your account</p>
        </div>

        {roleAlreadySet ? null : (
          <div className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-900">Choose your role</h2>
              <p className="text-sm text-gray-600">
                Select how you'll use Referral CRM so we can tailor your workspace.
              </p>
            </div>

            <div className="space-y-3">
              {roleOptions.map((option) => {
                const isActive = selectedRole === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedRole(option.value)}
                    className={`w-full rounded-lg border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black ${
                      isActive
                        ? 'border-black bg-gray-900/5'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-base font-semibold text-gray-900">{option.label}</span>
                      <span
                        className={`h-3 w-3 rounded-full border ${
                          isActive ? 'border-black bg-black' : 'border-gray-300'
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{option.description}</p>
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}

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
