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
  { type: 'link', href: '/referrals/follow-ups', label: 'Follow-up Tasks', roles: ['admin', 'mc', 'agent'] },
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
    <aside className={clsx('fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200', className)}>
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
        <div>
          <p className="text-sm font-semibold text-brand">AFC · AHA</p>
          <p className="text-xs text-slate-500">Referral CRM</p>
        </div>
        <NotificationBell session={session} />
      </div>
      <nav className="flex flex-col space-y-1.5 p-5">
        {compactNavItems.map((item, index) => {
          if (item.type === 'divider') {
            return <div key={`divider-${index}`} className="my-2 border-t border-slate-200" />;
          }

          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isReferralsParent =
            item.href === '/referrals' && pathname.startsWith('/referrals/follow-ups');
          const active = isActive && !isReferralsParent;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
                active
                  ? 'bg-brand text-white shadow-sm hover:bg-brand-dark hover:text-white'
                  : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto p-5">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-200 hover:text-slate-900"
        >
          <LogOutIcon className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
