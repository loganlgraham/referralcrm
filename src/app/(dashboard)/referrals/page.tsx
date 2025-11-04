import { Suspense } from 'react';
import { Metadata } from 'next';
import { ReferralTable, ReferralRow } from '@/components/tables/referral-table';
import { getCurrentSession } from '@/lib/auth';
import { getReferrals } from '@/lib/server/referrals';
import { Filters } from '@/components/forms/referral-filters';

export const metadata: Metadata = {
  title: 'Referrals | Referral CRM'
};

async function ReferralTableSection({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getCurrentSession();
  const data = await getReferrals({
    session,
    page: Number(searchParams.page || 1),
    status: searchParams.status?.toString(),
    mc: searchParams.mc?.toString(),
    agent: searchParams.agent?.toString(),
    state: searchParams.state?.toString(),
    zip: searchParams.zip?.toString()
  });

  return (
    <div className="space-y-4">
      <ReferralTable data={data.items as ReferralRow[]} />
    </div>
  );
}

export default async function ReferralsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return (
    <div className="space-y-6">
      <Filters />
      <Suspense fallback={<div>Loading referrals…</div>}>
        {/* @ts-expect-error Async Server Component */}
        <ReferralTableSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
