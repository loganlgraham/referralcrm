import { Metadata } from 'next';
import { PaymentsTable } from '@/components/tables/payments-table';

export const metadata: Metadata = {
  title: 'Payments | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <PaymentsTable />
    </div>
  );
}
