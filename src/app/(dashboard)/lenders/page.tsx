import { Metadata } from 'next';
import { MortgageConsultantSearch } from '@/components/lenders/mortgage-consultant-search';
import { LendersTable } from '@/components/tables/lenders-table';

export const metadata: Metadata = {
  title: 'Lenders | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default function LendersPage() {
  return (
    <div className="space-y-6">
      <MortgageConsultantSearch />
      <LendersTable />
    </div>
  );
}
