import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FindAgentExperience } from '@/components/find-agent/find-agent-experience';
import { getCurrentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Find Agent | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default async function FindAgentPage() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'agent') {
    notFound();
  }

  return <FindAgentExperience />;
}
