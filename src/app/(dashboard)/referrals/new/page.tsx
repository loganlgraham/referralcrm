import { Metadata } from 'next';
import { Suspense } from 'react';

import { ReferralForm } from '@/components/forms/referral-form';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'New Referral | Referral CRM'
};

export default async function NewReferralPage() {
  const session = await getCurrentSession();
  const isAgent = session?.user.role === 'agent';

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow="Pipeline"
        title={isAgent ? 'Introduce a client to AFC' : 'Start a new referral'}
        description={
          isAgent
            ? 'Share your client’s details so we can pair them with a mortgage consultant and keep you in the loop.'
            : "Capture the borrower's details, context, and pre-approval information so teammates can jump in without missing a beat."
        }
      />
      <Suspense
        fallback={<div className="h-96 animate-pulse rounded-card border border-border bg-surface-raised" />}
      >
        <ReferralForm />
      </Suspense>
    </div>
  );
}
