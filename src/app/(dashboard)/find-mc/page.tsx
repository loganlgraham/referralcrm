import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FindMcExperience } from '@/components/find-agent/find-mc-experience';
import { getCurrentSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Find Mortgage Consultant | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default async function FindMcPage() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'agent') {
    notFound();
  }

  return <FindMcExperience />;
}
