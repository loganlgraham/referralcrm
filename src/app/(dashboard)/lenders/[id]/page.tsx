import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getLenderProfile } from '@/lib/server/people';
import { PersonNotes } from '@/components/people/person-notes';

interface LenderDetailPageProps {
  params: { id: string };
}

export const metadata: Metadata = {
  title: 'Mortgage Consultant Detail | Referral CRM'
};

export default async function LenderDetailPage({ params }: LenderDetailPageProps) {
  const lender = await getLenderProfile(params.id);
  if (!lender) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{lender.name}</h1>
        <p className="mt-2 text-sm text-slate-600">{lender.email}</p>
        <p className="text-sm text-slate-600">{lender.phone || '—'}</p>
        <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase text-slate-400">NMLS ID</p>
            <p className="font-medium text-slate-900">{lender.nmlsId ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Licensed States</p>
            <p className="font-medium text-slate-900">{lender.licensedStates?.join(', ') || '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Team</p>
            <p className="font-medium text-slate-900">{lender.team ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Region</p>
            <p className="font-medium text-slate-900">{lender.region ?? '—'}</p>
          </div>
        </div>
      </div>
      <PersonNotes
        subjectId={params.id}
        initialNotes={lender.notes}
        endpoint="/api/lenders"
        description="Only admins and agents can view these notes. They remain hidden from the mortgage consultant by default."
      />
    </div>
  );
}
