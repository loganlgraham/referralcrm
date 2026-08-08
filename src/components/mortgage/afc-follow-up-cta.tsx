'use client';

import Link from 'next/link';
import { Send } from 'lucide-react';

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
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <p className="text-sm font-semibold text-foreground">Coordinate with AFC</p>
      <p className="mt-1 text-xs text-foreground-subtle">
        New client? Introduce them. Already paired with a mortgage consultant? Open their referral
        to leave an update.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link
          href={introduceHref}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white no-underline transition hover:bg-primary-hover"
        >
          <Send className="h-4 w-4" aria-hidden />
          Introduce a client
        </Link>
        <Link
          href="/referrals"
          className="inline-flex items-center justify-center rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm font-medium text-foreground no-underline transition hover:bg-surface-muted"
        >
          Update an existing referral
        </Link>
      </div>
    </div>
  );
}
