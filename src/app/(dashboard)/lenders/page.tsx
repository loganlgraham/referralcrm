import { Metadata } from 'next';
import { AdminLendersView } from '@/components/lenders/admin-lenders-view';
import { MortgageConsultantSearch } from '@/components/lenders/mortgage-consultant-search';
import { LendersTable } from '@/components/tables/lenders-table';
import { getCurrentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Lenders | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default async function LendersPage() {
  const session = await getCurrentSession();
  const isAdmin = session?.user?.role === 'admin';

  return (
    <div className="space-y-6">
      {isAdmin ? <AdminLendersView /> : (
        <>
          <MortgageConsultantSearch />
          <LendersTable />
        </>
      )}
    </div>
  );
}
