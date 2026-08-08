import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { AuthShell, AuthHeading } from '@/components/layout/auth-shell';

export default function CheckEmailPage() {
  return (
    <AuthShell
      hero={{
        eyebrow: 'AFC · AHA',
        title: 'Just one more step.',
        description: 'We sent a secure sign-in link to your inbox. Open it on any device to continue.',
      }}
    >
      <div className="flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary ring-1 ring-primary/20">
          <MailCheck className="h-6 w-6" aria-hidden />
        </span>
      </div>
      <AuthHeading
        eyebrow="AFC · AHA"
        title="Check your email"
        description="A sign-in link has been sent to your email address. Click the link to continue."
      />
      <p className="text-center text-sm text-foreground-muted">
        Didn&apos;t receive it?{' '}
        <Link href="/email" className="font-medium text-primary no-underline hover:underline">
          Try again
        </Link>
      </p>
    </AuthShell>
  );
}
