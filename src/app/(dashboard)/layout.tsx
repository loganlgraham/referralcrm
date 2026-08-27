import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentSession, Session } from '@/lib/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { DashboardClientShell } from '@/components/providers/dashboard-client-shell';
import { getAgentNeedsUpdateCount } from '@/lib/server/referrals';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session: Session | null = await getCurrentSession();

  if (!session) {
    redirect('/login');
  }

  if (!session.user.role || session.user.role === 'viewer') {
    redirect('/onboarding');
  }

  const needsUpdateCount = await getAgentNeedsUpdateCount(session);

  return (
    <div className="min-h-[100dvh] w-full bg-surface-muted overflow-x-hidden">
      <Sidebar session={session} className="hidden md:flex" needsUpdateCount={needsUpdateCount} />
      <MobileNav session={session} />
      <main className="px-4 pb-10 pt-6 md:ml-64 md:px-8 md:pb-12 md:pt-8">
        <DashboardClientShell>
          <div className="mx-auto max-w-7xl space-y-6">{children}</div>
        </DashboardClientShell>
      </main>
    </div>
  );
}
