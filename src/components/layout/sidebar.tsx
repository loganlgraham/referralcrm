'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Session } from 'next-auth';
import { LogOutIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/referrals', label: 'Referrals' },
  { href: '/agents', label: 'Agents' },
  { href: '/lenders', label: 'Lenders' },
  { href: '/payments', label: 'Payments' },
  { href: '/imports', label: 'Imports' },
  { href: '/settings', label: 'Settings', roles: ['admin', 'manager'] }
];

export function Sidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const role = session.user.role;

  return (
    <aside className="fixed inset-y-0 left-0 z-20 w-64 bg-white shadow-lg">
      <div className="flex h-16 items-center justify-between border-b px-6">
        <div>
          <p className="text-sm font-semibold text-brand">AFC · AHA</p>
          <p className="text-xs text-slate-500">Referral CRM</p>
        </div>
      </div>
      <nav className="flex flex-col space-y-1 p-4">
        {navItems
          .filter((item) => !item.roles || item.roles.includes(role))
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'rounded-md px-4 py-2 text-sm font-medium transition hover:bg-slate-100',
                pathname.startsWith(item.href) && 'bg-brand text-white hover:bg-brand'
              )}
            >
              {item.label}
            </Link>
          ))}
      </nav>
      <div className="mt-auto p-4">
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-300"
        >
          <LogOutIcon className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
