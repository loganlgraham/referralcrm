import { Metadata } from 'next';
import { AgentsTable } from '@/components/tables/agents-table';

export const metadata: Metadata = {
  title: 'Agents | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <AgentsTable />
    </div>
  );
}
