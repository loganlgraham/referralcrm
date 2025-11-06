import Link from 'next/link';
import { Metadata } from 'next';
import { KPICards } from '@/components/charts/kpi-cards';
import { Leaderboards } from '@/components/charts/leaderboards';
import { ReferralTable, ReferralRow } from '@/components/tables/referral-table';
import { getCurrentSession } from '@/lib/auth';
import { getReferrals } from '@/lib/server/referrals';

export const metadata: Metadata = {
  title: 'Dashboard | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getCurrentSession();
  const role = (session?.user?.role as 'admin' | 'manager' | 'mc' | 'agent' | 'viewer' | undefined) ?? 'viewer';
  const tableMode: 'admin' | 'mc' | 'agent' = role === 'agent' ? 'agent' : role === 'mc' ? 'mc' : 'admin';
  const shouldShowLeaderboards = role === 'admin' || role === 'manager';

  const previewSource = !shouldShowLeaderboards
    ? await getReferrals({ session, page: 1 })
    : null;

  const previewItems = (previewSource?.items.slice(0, 5) ?? []) as ReferralRow[];
  const hasPreview = previewItems.length > 0;

  return (
    <div className="space-y-8">
      <KPICards />
      {shouldShowLeaderboards ? (
        <Leaderboards />
      ) : (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Active referrals</h2>
              <p className="text-sm text-slate-500">
                {tableMode === 'agent'
                  ? 'Your most recent leads appear here. Update their status or add a note without leaving the dashboard.'
                  : 'Recent referrals routed to your lenders show here so you can stay in sync with each agent partner.'}
              </p>
            </div>
            <Link
              href="/referrals"
              className="text-sm font-semibold text-brand hover:underline"
            >
              View all
            </Link>
          </div>
          {hasPreview ? (
            <ReferralTable data={previewItems} mode={tableMode} />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
              You don’t have any referrals yet. Once you add one, it will appear here.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
