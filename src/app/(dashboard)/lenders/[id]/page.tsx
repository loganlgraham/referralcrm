import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getCurrentSession } from '@/lib/auth';
import { getLenderProfile } from '@/lib/server/people';
import { PersonNotes } from '@/components/people/person-notes';
import { PersonDealsTable } from '@/components/people/person-deals-table';
import { LenderOverviewCard } from '@/components/people/lender-overview-card';
import { PersonDeleteSection } from '@/components/people/person-delete-section';

interface LenderDetailPageProps {
  params: { id: string };
}

export const metadata: Metadata = {
  title: 'Mortgage Consultant Detail | Referral CRM'
};

export default async function LenderDetailPage({ params }: LenderDetailPageProps) {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'agent')) {
    notFound();
  }

  const lender = await getLenderProfile(params.id);
  if (!lender) {
    notFound();
  }

  const isAdmin = session.user.role === 'admin';

  return (
    <div className="space-y-6">
      <LenderOverviewCard lender={lender} isAdmin={isAdmin} />
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Deals</h2>
        <div className="mt-4">
          <PersonDealsTable deals={lender.deals} context="mc" />
        </div>
      </div>
      <PersonNotes
        subjectId={params.id}
        initialNotes={lender.notes}
        endpoint="/api/lenders"
        description="Only admins and agents can view these notes. They remain hidden from the mortgage consultant by default."
      />
      {isAdmin && (
        <PersonDeleteSection
          id={params.id}
          label="mortgage consultant"
          endpoint="/api/lenders"
          redirectPath="/lenders"
          details="Deleting this mortgage consultant removes their profile, notes, and login access. Deals and referrals will stay recorded."
        />
      )}
    </div>
  );
}
