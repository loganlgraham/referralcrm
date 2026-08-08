'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Session } from 'next-auth';
import { signOut } from 'next-auth/react';
import {
  Building2,
  Calculator,
  ClipboardList,
  Download,
  BadgeDollarSign,
  LayoutDashboard,
  LineChart,
  ListFilter,
  LogOut,
  Search,
  Settings,
  UserCircle,
  Users,
  type LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { BrandMark } from '@/components/ui/brand-mark';
import { NotificationBell } from '@/components/layout/notification-bell';

type Role = 'admin' | 'mc' | 'agent' | string;

type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
};

type NavSection = {
  label: string;
  items: NavLink[];
  roles?: Role[];
};

export const navSections: NavSection[] = [
  {
    label: 'Work',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin'] },
      { href: '/referrals', label: 'Referrals', icon: ClipboardList, roles: ['admin', 'mc', 'agent'] },
      { href: '/deals', label: 'Deals', icon: BadgeDollarSign, roles: ['admin', 'agent'] },
      { href: '/admin/tasks', label: 'Admin Tasks', icon: ListFilter, roles: ['admin'] }
    ]
  },
  {
    label: 'People',
    items: [
      { href: '/agents', label: 'Agents', icon: Users, roles: ['admin'] },
      { href: '/find-agent', label: 'Find Referral Agent', icon: Search, roles: ['agent'] },
      { href: '/lenders', label: 'Mortgage Consultants', icon: Building2, roles: ['admin'] }
    ]
  },
  {
    label: 'Tools',
    items: [
      { href: '/mortgage-market', label: 'Mortgage Market', icon: LineChart, roles: ['agent'] },
      { href: '/mortgage-calculator', label: 'Mortgage Calculator', icon: Calculator, roles: ['agent'] }
    ]
  },
  {
    label: 'Account',
    items: [
      { href: '/profile', label: 'My Profile', icon: UserCircle, roles: ['agent', 'mc'] },
      { href: '/imports', label: 'Imports', icon: Download, roles: ['admin'] },
      { href: '/settings', label: 'Settings', icon: Settings, roles: ['admin'] }
    ]
  }
];

/** Flat list preserved for backwards compatibility (used by existing imports). */
export const navItems = navSections.flatMap((section) =>
  section.items.map((item) => ({ type: 'link' as const, href: item.href, label: item.label, roles: item.roles }))
);

function filterSections(role: Role): NavSection[] {
  return navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles || item.roles.includes(role))
    }))
    .filter((section) => section.items.length > 0);
}

function RoleLabel({ role }: { role: Role }) {
  if (role === 'admin') return <span>Admin</span>;
  if (role === 'mc') return <span>Mortgage Consultant</span>;
  if (role === 'agent') return <span>Agent</span>;
  return <span className="capitalize">{role}</span>;
}

export function Sidebar({ session, className }: { session: Session; className?: string }) {
  const pathname = usePathname();
  const role = session.user.role;
  const sections = filterSections(role);

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/10 bg-primary text-white',
        className
      )}
    >
      <div className="relative flex h-[72px] items-center justify-between gap-2 border-b border-white/10 px-5">
        <Link
          href={role === 'admin' ? '/dashboard' : '/referrals'}
          className="group flex min-w-0 items-center gap-2.5 no-underline"
        >
          <BrandMark inverted />
        </Link>
        <NotificationBell session={session} inverted />
      </div>

      <div className="relative mx-5 mt-5 border-l-2 border-signal/70 pl-3">
        <p className="route-label text-[9px] text-white/50">AFC · AHA network</p>
      </div>

      <nav className="relative flex-1 overflow-y-auto scrollbar-thin px-3 py-5">
        {sections.map((section) => (
          <div key={section.label} className="mb-5 last:mb-0">
            <p className="route-label px-3 pb-2 text-[9px] text-white/40">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isExact = pathname === item.href;
                const isNested = pathname.startsWith(`${item.href}/`);
                // Referrals parent shouldn't stay highlighted when admin tasks is active.
                const excluded = item.href === '/referrals' && pathname.startsWith('/admin/tasks');
                const active = (isExact || isNested) && !excluded;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium no-underline transition',
                        active
                          ? 'bg-white text-primary shadow-sm'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute -left-[3px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-[3px] border-primary bg-signal"
                        />
                      )}
                      <Icon
                        aria-hidden
                        className={cn(
                          'h-4 w-4 shrink-0',
                          active ? 'text-primary' : 'text-white/40 group-hover:text-white/75'
                        )}
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

      <UserChip session={session} />
    </aside>
  );
}

function UserChip({ session }: { session: Session }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = session.user.name ?? session.user.email ?? 'User';
  const role = session.user.role;
  const handleSignOut = async () => {
    const result = await signOut({ callbackUrl: '/login', redirect: false });
    const url = result?.url ?? '/login';
    window.location.href = url;
  };

  return (
    <div className="relative border-t border-white/10 p-3">
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <Avatar name={name} highlighted size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{name}</p>
          <p className="truncate text-[11px] text-white/50">
            <RoleLabel role={role} />
          </p>
        </div>
      </button>
      {menuOpen && (
        <div
          className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-lg border border-white/10 bg-primary-hover shadow-raised animate-fade-in"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4 text-white/50" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
