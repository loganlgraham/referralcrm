import { Metadata } from 'next';

import { DealsTable } from '@/components/tables/deals-table';

export const metadata: Metadata = {
  title: 'Deals | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default function DealsPage() {
  return (
    <div className="space-y-6">
      <DealsTable />
    </div>
  );
}
