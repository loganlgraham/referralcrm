'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MenuIcon, XIcon, LogOutIcon } from 'lucide-react';
import { Session } from 'next-auth';
import { signOut } from 'next-auth/react';

import { navSections } from './sidebar';
import { NotificationBell } from './notification-bell';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { BrandMark } from '@/components/ui/brand-mark';

type MobileNavProps = {
  session: Session;
};

export function MobileNav({ session }: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const role = session.user.role;

  useEffect(() => {
    if (!open) {
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const sections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles || item.roles.includes(role))
    }))
    .filter((section) => section.items.length > 0);

  const handleSignOut = async () => {
    const result = await signOut({ callbackUrl: '/login', redirect: false });
    const url = result?.url ?? '/login';
    window.location.href = url;
  };

  const name = session.user.name ?? session.user.email ?? 'User';

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0F172A]/95 text-white backdrop-blur md:hidden">
        <div className="flex h-16 items-center justify-between px-4">
          <Link href={role === 'admin' ? '/dashboard' : '/referrals'} className="flex items-center gap-2 no-underline">
            <BrandMark inverted />
          </Link>
          <div className="flex items-center gap-1.5">
            <NotificationBell session={session} inverted />
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="inline-flex items-center rounded-md border border-white/20 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              aria-label={open ? 'Close navigation' : 'Open navigation'}
              aria-expanded={open}
            >
              {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Slide-over drawer */}
      <div
        className={cn(
          'fixed inset-0 z-40 transition md:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none'
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            'absolute inset-0 bg-[hsl(var(--text))]/40 transition-opacity duration-200',
            open ? 'opacity-100' : 'opacity-0'
          )}
        />
        <aside
          className={cn(
            'absolute inset-y-0 right-0 flex w-[82%] max-w-sm flex-col border-l border-white/10 bg-[#0F172A] text-white shadow-raised transition-transform duration-200',
            open ? 'translate-x-0' : 'translate-x-full'
          )}
          role="dialog"
          aria-label="Navigation"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <Avatar name={name} highlighted />
              <div className="leading-tight">
                <p className="text-sm font-medium text-white">{name}</p>
                <p className="text-[11px] text-white/50 capitalize">
                  {role === 'mc' ? 'Mortgage Consultant' : role}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-2 text-white/50 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              aria-label="Close navigation"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4">
            {sections.map((section) => (
              <div key={section.label} className="mb-4 last:mb-0">
                <p className="route-label px-3 pb-1.5 text-[9px] text-white/40">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isExact = pathname === item.href;
                    const isNested = pathname.startsWith(`${item.href}/`);
                    const excluded = item.href === '/referrals' && pathname.startsWith('/admin/tasks');
                    const active = (isExact || isNested) && !excluded;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className={cn(
                            'relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium no-underline transition',
                            active
                              ? 'bg-white text-[#0F172A]'
                              : 'text-white/70 hover:bg-white/10 hover:text-white'
                          )}
                        >
                          <Icon
                            aria-hidden
                            className={cn('h-4 w-4 shrink-0', active ? 'text-primary-600' : 'text-white/40')}
                          />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="border-t border-white/10 p-3">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white/75 transition hover:bg-white/20 hover:text-white"
            >
              <LogOutIcon className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
