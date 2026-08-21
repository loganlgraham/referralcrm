'use client';

import Link from 'next/link';
import { Send } from 'lucide-react';

import { buttonClasses } from '@/components/ui/button';

type AfcFollowUpCtaProps = {
  notesHint?: string;
  zipHint?: string;
};

export function AfcFollowUpCta({ notesHint, zipHint }: AfcFollowUpCtaProps) {
  const params = new URLSearchParams();
  if (notesHint?.trim()) {
    params.set('notes', notesHint.trim().slice(0, 500));
  }
  if (zipHint?.trim()) {
    params.set('zip', zipHint.trim().slice(0, 5));
  }
  const introduceHref = params.toString() ? `/referrals/new?${params.toString()}` : '/referrals/new';

  return (
    <section className="route-surface rounded-card border border-border bg-surface-raised py-4 pl-5 pr-4 shadow-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-eyebrow text-foreground-subtle">Coordinate with AFC</h2>
          <p className="mt-1.5 text-sm text-foreground-muted">
            New client? Introduce them. Already paired with a mortgage consultant? Open their
            referral to leave an update.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Link href={introduceHref} className={buttonClasses()}>
            <Send className="h-4 w-4" aria-hidden />
            Introduce a client
          </Link>
          <Link href="/referrals" className={buttonClasses({ variant: 'secondary' })}>
            Update an existing referral
          </Link>
        </div>
      </div>
    </section>
  );
}
