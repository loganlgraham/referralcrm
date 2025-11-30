import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { MortgageCalculator } from '@/components/mortgage/mortgage-calculator';
import { getCurrentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Mortgage Calculator | Referral CRM',
};

export const dynamic = 'force-dynamic';

export default async function MortgageCalculatorPage() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'agent') {
    notFound();
  }

  return (
    <div className="space-y-6">
      <MortgageCalculator />
    </div>
  );
}
