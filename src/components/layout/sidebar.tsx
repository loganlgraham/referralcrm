'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Session } from 'next-auth';
import { LogOutIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';

type Role = 'admin' | 'mc' | 'agent' | string;

const navItems: Array<{ href: string; label: string; roles?: Role[] }> = [
  { href: '/dashboard', label: 'Dashboard', roles: ['admin'] },
  { href: '/referrals', label: 'Referrals', roles: ['admin', 'mc', 'agent'] },
  { href: '/referrals/follow-ups', label: 'Follow-up Tasks', roles: ['admin', 'mc', 'agent'] },
  { href: '/agents', label: 'Agents', roles: ['admin', 'mc'] },
  { href: '/lenders', label: 'Mortgage Consultants', roles: ['admin', 'agent'] },
  { href: '/deals', label: 'Deals', roles: ['admin', 'agent'] },
  { href: '/imports', label: 'Imports', roles: ['admin'] },
  { href: '/profile', label: 'My Profile', roles: ['agent', 'mc'] },
  { href: '/settings', label: 'Settings', roles: ['admin'] }
];

export function Sidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const role = session.user.role;

  const handleSignOut = async () => {
    const result = await signOut({ callbackUrl: '/login', redirect: false });
    const url = result?.url ?? '/login';
    window.location.href = url;
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-lg">
      <div className="flex h-16 items-center justify-between border-b px-6">
        <div>
          <p className="text-sm font-semibold text-brand">AFC · AHA</p>
          <p className="text-xs text-slate-500">Referral CRM</p>
        </div>
      </div>
      <nav className="flex flex-col space-y-1 p-4">
        {navItems
          .filter((item) => !item.roles || item.roles.includes(role))
          .map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const isReferralsParent =
              item.href === '/referrals' && pathname.startsWith('/referrals/follow-ups');
            const active = isActive && !isReferralsParent;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'rounded-md px-4 py-2 text-sm font-medium transition hover:bg-slate-100',
                  active && 'bg-brand text-white hover:bg-brand'
                )}
              >
                {item.label}
              </Link>
            );
          })}
      </nav>
      <div className="mt-auto p-4">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-300"
        >
          <LogOutIcon className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
