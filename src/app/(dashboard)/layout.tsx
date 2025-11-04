import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import { Sidebar } from '@/components/layout/sidebar';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen w-full bg-slate-100">
      <Sidebar session={session} />
      <main className="ml-64 px-8 py-8">
        <div className="mx-auto max-w-7xl space-y-6">{children}</div>
      </main>
    </div>
  );
}
