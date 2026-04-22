'use client';

import { signIn } from 'next-auth/react';
import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell, AuthHeading } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

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
      window.location.href = result.url;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-[hsl(var(--danger))]">
          {error}
        </div>
      )}

      <Field id="email" label="Email address">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={loading}
        />
      </Field>

      <Button type="submit" loading={loading} size="lg" className="w-full">
        {loading ? 'Sending link…' : 'Send sign-in link'}
      </Button>
    </form>
  );
}

export default function EmailSignInPage() {
  return (
    <AuthShell
      hero={{
        eyebrow: 'AFC · AHA',
        title: 'Skip the password — sign in by email.',
        description: 'Enter your work email and we will send you a secure sign-in link.',
      }}
    >
      <AuthHeading
        eyebrow="AFC · AHA"
        title="Continue with email"
        description="Enter your email to receive a sign-in link."
      />

      <Suspense fallback={<div className="h-40 w-full animate-pulse rounded-md bg-surface-muted" />}>
        <EmailSignInForm />
      </Suspense>

      <p className="text-center text-sm text-foreground-muted">
        <Link href="/login" className="font-medium text-primary-700 no-underline hover:underline">
          Back to login
        </Link>
      </p>
    </AuthShell>
  );
}
