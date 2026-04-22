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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Mortgage Consultants</h1>
              <p className="text-sm text-foreground-subtle">Find and collaborate with licensed mortgage consultants.</p>
            </div>
          </div>
          <MortgageConsultantSearch />
          <LendersTable />
        </>
      )}
    </div>
  );
}
