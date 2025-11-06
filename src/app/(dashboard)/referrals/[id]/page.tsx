import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReferralById } from '@/lib/server/referrals';
import { ReferralHeader } from '@/components/referrals/referral-header';
import { ReferralTimeline } from '@/components/referrals/referral-timeline';
import { PaymentCard } from '@/components/referrals/payment-card';
import { ReferralNotes } from '@/components/referrals/referral-notes';

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
    <div className="space-y-6">
      <ReferralHeader referral={referral} viewerRole={viewerRole} />
      <ReferralNotes referralId={params.id} initialNotes={notes} viewerRole={viewerRole} />
      <ReferralTimeline referralId={params.id} />
      <PaymentCard referral={referral} />
    </div>
  );
}
