import { Metadata } from 'next';
import { AdminAgentsView } from '@/components/agents/admin-agents-view';
import { AgentsTable } from '@/components/tables/agents-table';
import { getCurrentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Agents | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const session = await getCurrentSession();
  const isAdmin = session?.user?.role === 'admin';

  return (
    <div className="space-y-6">
      {isAdmin ? <AdminAgentsView /> : <AgentsTable />}
    </div>
  );
}
