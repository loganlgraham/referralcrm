import { Metadata } from 'next';
import { Suspense } from 'react';

import { ReferralForm } from '@/components/forms/referral-form';

export const metadata: Metadata = {
  title: 'New Referral | Referral CRM'
};

export default function NewReferralPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-0">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg border border-border bg-surface-raised" />}>
        <ReferralForm />
      </Suspense>
    </div>
  );
}
