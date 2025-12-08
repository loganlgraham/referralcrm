'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MenuIcon, XIcon, LogOutIcon } from 'lucide-react';
import { useState } from 'react';
import { Session } from 'next-auth';
import clsx from 'clsx';
import { signOut } from 'next-auth/react';

import { navItems } from './sidebar';

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
    <header className="sticky top-0 z-30 bg-white shadow-sm md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <div>
          <p className="text-sm font-semibold text-brand">AFC · AHA</p>
          <p className="text-xs text-slate-500">Referral CRM</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex items-center rounded-md border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition hover:bg-slate-50 focus:outline-none"
          aria-label="Toggle navigation"
        >
          {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-slate-200 bg-white">
          <nav className="flex flex-col">
            {compactNavItems.map((item, index) => {
              if (item.type === 'divider') {
                return <div key={`mobile-divider-${index}`} className="my-1 border-t border-slate-200" />;
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
                    'px-4 py-3 text-sm font-medium transition hover:bg-slate-100',
                    active
                      ? 'bg-brand text-white hover:bg-brand-dark hover:text-white'
                      : 'text-slate-700'
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="p-4">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-300"
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
