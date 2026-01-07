import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentSession, Session } from '@/lib/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { DashboardClientShell } from '@/components/providers/dashboard-client-shell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session: Session | null = await getCurrentSession();

  if (!session) {
    redirect('/login');
  }

  if (!session.user.role || session.user.role === 'viewer') {
    redirect('/onboarding');
  }

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 overflow-x-hidden">
      <Sidebar session={session} className="hidden md:block" />
      <MobileNav session={session} />
      <main className="px-6 py-8 md:ml-64 md:px-10 md:py-10">
        <DashboardClientShell>
          <div className="mx-auto max-w-7xl space-y-8">{children}</div>
        </DashboardClientShell>
      </main>
    </div>
  );
}
