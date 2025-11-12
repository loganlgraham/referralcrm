import { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminFollowUpTasksPanel } from '@/components/referrals/admin-follow-up-tasks';
import { getCurrentSession } from '@/lib/auth';
import { getReferrals } from '@/lib/server/referrals';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Follow-up Tasks | Referral CRM',
};

interface ReferralTasksPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function ReferralTasksPage({ searchParams }: ReferralTasksPageProps) {
  const session = await getCurrentSession();

  if (!session) {
    redirect('/login');
  }

  if (session.user.role !== 'admin') {
    redirect('/referrals');
  }

  const page = Number(searchParams.page || 1);
  const data = await getReferrals({ session, page });
  const referrals = data.items ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Follow-up task queue</h1>
        <p className="text-sm text-slate-500">
          Review every referral&apos;s outreach plan in one place. Mark actions complete to keep work-in-progress focused on what&apos;s
          outstanding.
        </p>
      </div>

      {referrals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No referrals available. <Link href="/referrals" className="font-semibold text-brand hover:underline">Add a referral</Link> to start
          planning outreach.
        </div>
      ) : (
        <div className="space-y-6">
          {referrals.map((referral) => (
            <section
              key={referral._id}
              className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Borrower</div>
                  <Link
                    href={`/referrals/${referral._id}`}
                    className="text-lg font-semibold text-slate-900 transition hover:text-brand"
                  >
                    {referral.borrowerName || 'Unnamed referral'}
                  </Link>
                  <p className="text-sm text-slate-500">
                    {referral.borrowerEmail || 'Email unavailable'} · {referral.borrowerPhone || 'Phone unavailable'}
                  </p>
                </div>
                <div className="text-right text-sm text-slate-500">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</div>
                  <p className="text-sm font-semibold text-slate-800">{referral.status || 'Unknown'}</p>
                  {referral.assignedAgentName && (
                    <p className="text-xs text-slate-500">Agent: {referral.assignedAgentName}</p>
                  )}
                  {referral.lenderName && <p className="text-xs text-slate-500">MC: {referral.lenderName}</p>}
                </div>
              </div>
              <AdminFollowUpTasksPanel referralId={referral._id} showHeader={false} variant="plain" />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
