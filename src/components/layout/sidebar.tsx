'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Session } from 'next-auth';
import { LogOutIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { NotificationBell } from './notification-bell';

type Role = 'admin' | 'mc' | 'agent' | string;

type NavItem =
  | { type: 'link'; href: string; label: string; roles?: Role[] }
  | { type: 'divider'; roles?: Role[] };

export const navItems: NavItem[] = [
  { type: 'link', href: '/dashboard', label: 'Dashboard', roles: ['admin'] },
  { type: 'link', href: '/referrals', label: 'Referrals', roles: ['admin', 'mc', 'agent'] },
  { type: 'link', href: '/deals', label: 'Deals', roles: ['admin', 'agent'] },
  { type: 'link', href: '/admin/tasks', label: 'Admin Tasks', roles: ['admin'] },
  { type: 'divider' },
  { type: 'link', href: '/agents', label: 'Agents', roles: ['admin'] },
  { type: 'link', href: '/find-agent', label: 'Find Referral Agent', roles: ['agent'] },
  { type: 'link', href: '/lenders', label: 'Mortgage Consultants', roles: ['admin', 'agent'] },
  { type: 'divider' },
  { type: 'link', href: '/mortgage-market', label: 'Mortgage Market', roles: ['agent'] },
  { type: 'link', href: '/mortgage-calculator', label: 'Mortgage Calculator', roles: ['agent'] },
  { type: 'divider' },
  { type: 'link', href: '/profile', label: 'My Profile', roles: ['agent', 'mc'] },
  { type: 'link', href: '/imports', label: 'Imports', roles: ['admin'] },
  { type: 'link', href: '/settings', label: 'Settings', roles: ['admin'] },
];

export function Sidebar({ session, className }: { session: Session; className?: string }) {
  const pathname = usePathname();
  const role = session.user.role;

  const visibleNavItems = navItems.filter((item) => !item.roles || item.roles.includes(role));
  const compactNavItems = visibleNavItems.reduce<NavItem[]>((acc, item) => {
    if (item.type === 'divider') {
      const last = acc[acc.length - 1];
      if (!last || last.type === 'divider') {
        return acc;
      }
    }
    acc.push(item);
    return acc;
  }, []);
  if (compactNavItems[compactNavItems.length - 1]?.type === 'divider') {
    compactNavItems.pop();
  }

  const handleSignOut = async () => {
    const result = await signOut({ callbackUrl: '/login', redirect: false });
    const url = result?.url ?? '/login';
    window.location.href = url;
  };

  return (
    <aside className={clsx('fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900', className)}>
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-700/50 px-6">
        <div>
          <p className="text-sm font-semibold text-white">AFC · AHA</p>
          <p className="text-xs text-slate-400">Referral CRM</p>
        </div>
        <NotificationBell session={session} />
      </div>
      <nav className="flex flex-1 flex-col space-y-0.5 overflow-y-auto p-3">
        {compactNavItems.map((item, index) => {
          if (item.type === 'divider') {
            return <div key={`divider-${index}`} className="my-2 border-t border-slate-700/50" />;
          }

          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isReferralsParent =
            item.href === '/referrals' && pathname.startsWith('/admin/tasks');
          const active = isActive && !isReferralsParent;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition',
                active
                  ? 'bg-brand/15 text-brand-light before:absolute before:left-0 before:top-1/2 before:h-5 before:-translate-y-1/2 before:w-0.5 before:rounded-r before:bg-brand-light before:content-[\'\']'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="shrink-0 border-t border-slate-700/50 p-3">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-white/5 px-4 py-2 text-sm font-medium text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <LogOutIcon className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
