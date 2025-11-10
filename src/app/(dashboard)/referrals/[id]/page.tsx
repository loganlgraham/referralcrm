import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReferralById } from '@/lib/server/referrals';
import { ReferralDetailClient } from '@/components/referrals/referral-detail-client';

interface ReferralDetailPageProps {
  params: { id: string };
}

export const metadata: Metadata = {
  title: 'Referral Detail | Referral CRM'
};

export default async function ReferralDetailPage({ params }: ReferralDetailPageProps) {
  const referral = await getReferralById(params.id);
  if (!referral) {
    notFound();
  }

  const viewerRole = referral.viewerRole ?? 'viewer';
  const notes = referral.notes ?? [];

  return (
    <ReferralDetailClient
      referral={referral}
      viewerRole={viewerRole}
      notes={notes}
      referralId={params.id}
    />
  );
}
