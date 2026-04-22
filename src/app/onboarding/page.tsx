'use client';

export const dynamic = 'force-dynamic';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { AuthShell, AuthHeading } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

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

function CenteredSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden />
        {label && <p className="mt-4 text-sm text-foreground-muted">{label}</p>}
      </div>
    </div>
  );
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
    } catch {
      setError('Could not save role.');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') {
    return <CenteredSpinner label="Loading..." />;
  }

  if (!session) return null;

  if (redirecting) {
    return <CenteredSpinner label="Redirecting you to your workspace…" />;
  }

  return (
    <AuthShell
      hero={{
        eyebrow: 'Welcome to Referrio',
        title: 'Tell us how you work, and we will tailor the rest.',
        description:
          'Pick the role that matches how you use the network — you can always adjust later from Settings.',
      }}
    >
      <AuthHeading
        eyebrow="Welcome"
        title="Finish setting up your account"
        description="Select how you'll use Referrio so we can tailor your workspace."
      />

      {roleAlreadySet ? null : (
        <div className="space-y-5">
          <div className="space-y-2.5">
            {roleOptions.map((option) => {
              const isActive = selectedRole === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedRole(option.value)}
                  className={cn(
                    'group w-full rounded-md border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                    isActive
                      ? 'border-primary-500 bg-primary-50/70 shadow-sm'
                      : 'border-border bg-surface hover:border-border-strong hover:bg-surface-muted'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={cn(
                        'text-base font-semibold',
                        isActive ? 'text-primary-700' : 'text-foreground'
                      )}
                    >
                      {option.label}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border-2 transition',
                        isActive ? 'border-primary-600 bg-primary-600' : 'border-border-strong'
                      )}
                    >
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-surface-raised" />}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground-muted">{option.description}</p>
                </button>
              );
            })}
          </div>

          {error && (
            <div
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-[hsl(var(--danger))]"
              role="alert"
            >
              {error}
            </div>
          )}

          <Button onClick={saveRole} loading={saving} size="lg" className="w-full">
            {saving ? 'Saving...' : 'Confirm and continue'}
          </Button>
        </div>
      )}
    </AuthShell>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<CenteredSpinner />}>
      <OnboardingInner />
    </Suspense>
  );
}
