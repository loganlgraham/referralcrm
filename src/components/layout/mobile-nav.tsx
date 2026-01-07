'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MenuIcon, XIcon, LogOutIcon } from 'lucide-react';
import { useState } from 'react';
import { Session } from 'next-auth';
import clsx from 'clsx';
import { signOut } from 'next-auth/react';

import { navItems } from './sidebar';
import { NotificationBell } from './notification-bell';

type MobileNavProps = {
  session: Session;
};

export function MobileNav({ session }: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const role = session.user.role;

  const handleSignOut = async () => {
    const result = await signOut({ callbackUrl: '/login', redirect: false });
    const url = result?.url ?? '/login';
    window.location.href = url;
  };

  const filteredNavItems = navItems.filter((item) => !item.roles || item.roles.includes(role));
  const compactNavItems = filteredNavItems.reduce<typeof navItems>((acc, item) => {
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

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 md:hidden">
      <div className="flex h-14 items-center justify-between px-5">
        <div>
          <p className="text-sm font-semibold text-brand">AFC · AHA</p>
          <p className="text-xs text-slate-500">Referral CRM</p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell session={session} />
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-all duration-200 hover:bg-slate-50 hover:border-slate-300 focus:outline-none"
            aria-label="Toggle navigation"
          >
            {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-slate-200 bg-white">
          <nav className="flex flex-col p-2">
            {compactNavItems.map((item, index) => {
              if (item.type === 'divider') {
                return <div key={`mobile-divider-${index}`} className="my-2 border-t border-slate-200" />;
              }

              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const isReferralsParent = item.href === '/referrals' && pathname.startsWith('/referrals/follow-ups');
              const active = isActive && !isReferralsParent;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
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
          <div className="p-5">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-200 hover:text-slate-900"
            >
              <LogOutIcon className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
