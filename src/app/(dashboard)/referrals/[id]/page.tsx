import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReferralById } from '@/lib/server/referrals';
import { ReferralHeader } from '@/components/referrals/referral-header';
import { ReferralTimeline } from '@/components/referrals/referral-timeline';
import { PaymentCard } from '@/components/referrals/payment-card';

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

  return (
    <div className="space-y-6">
      <ReferralHeader referral={referral} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <ReferralTimeline referralId={params.id} />
        </div>
        <div className="space-y-6">
          <PaymentCard referral={referral} />
        </div>
      </div>
    </div>
  );
}
