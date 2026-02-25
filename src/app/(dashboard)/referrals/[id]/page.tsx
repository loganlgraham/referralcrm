import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReferralById, getAdjacentReferralIds } from '@/lib/server/referrals';
import { getCurrentSession } from '@/lib/auth';
import { ReferralDetailClient } from '@/components/referrals/referral-detail-client';

interface ReferralDetailPageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export const metadata: Metadata = {
  title: 'Referral Detail | Referral CRM'
};

export default async function ReferralDetailPage({ params, searchParams }: ReferralDetailPageProps) {
  const [referral, session] = await Promise.all([
    getReferralById(params.id),
    getCurrentSession(),
  ]);

  if (!referral) {
    notFound();
  }

  const viewerRole = referral.viewerRole ?? 'viewer';
  const notes = referral.notes ?? [];

  const isAdminLike = viewerRole === 'admin' || viewerRole === 'manager';
  const hasListContext = Boolean(
    searchParams.sortBy || searchParams.sortDirection || searchParams.status ||
    searchParams.mc || searchParams.agent || searchParams.zip ||
    searchParams.search || searchParams.ahaBucket || searchParams.agentReferrals
  );

  let prevReferralId: string | null = null;
  let nextReferralId: string | null = null;
  let listParams = '';

  if (isAdminLike && hasListContext) {
    const adjacentIds = await getAdjacentReferralIds(params.id, {
      session,
      status: searchParams.status?.toString(),
      mc: searchParams.mc?.toString(),
      agent: searchParams.agent?.toString(),
      zip: searchParams.zip?.toString(),
      search: searchParams.search?.toString() ?? null,
      ahaBucket: searchParams.ahaBucket?.toString() ?? null,
      agentReferrals: (searchParams.agentReferrals?.toString() as 'yes' | 'no' | undefined) ?? null,
      sortBy: searchParams.sortBy?.toString() ?? null,
      sortDirection: (searchParams.sortDirection?.toString() as 'asc' | 'desc' | undefined) ?? null,
    });
    prevReferralId = adjacentIds.prevId;
    nextReferralId = adjacentIds.nextId;

    const preserved = new URLSearchParams();
    const forwardKeys = ['sortBy', 'sortDirection', 'status', 'mc', 'agent', 'zip', 'search', 'ahaBucket', 'agentReferrals', 'timeline'];
    for (const key of forwardKeys) {
      const value = searchParams[key];
      if (typeof value === 'string') {
        preserved.set(key, value);
      }
    }
    listParams = preserved.toString();
  } else if (isAdminLike) {
    const adjacentIds = await getAdjacentReferralIds(params.id, {
      session,
    });
    prevReferralId = adjacentIds.prevId;
    nextReferralId = adjacentIds.nextId;
  }

  return (
    <ReferralDetailClient
      referral={referral}
      viewerRole={viewerRole}
      notes={notes}
      referralId={params.id}
      prevReferralId={prevReferralId}
      nextReferralId={nextReferralId}
      listParams={listParams}
    />
  );
}
