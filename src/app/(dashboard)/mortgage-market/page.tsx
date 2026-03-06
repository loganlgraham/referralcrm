import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { MarketIntelWidget } from '@/components/mortgage/market-intel-widget';
import { getCurrentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Market Intelligence | Referral CRM',
};

export const dynamic = 'force-dynamic';

export default async function MortgageMarketPage() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'agent') {
    notFound();
  }

  return (
    <div className="space-y-6">
      <MarketIntelWidget />
    </div>
  );
}
