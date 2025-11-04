import { Metadata } from 'next';
import { LendersTable } from '@/components/tables/lenders-table';

export const metadata: Metadata = {
  title: 'Lenders | Referral CRM'
};

export default function LendersPage() {
  return (
    <div className="space-y-6">
      <LendersTable />
    </div>
  );
}
