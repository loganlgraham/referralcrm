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
      { href: '/lenders', label: 'Mortgage Consultants', icon: Building2, roles: ['admin', 'agent'] }
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
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface-raised',
        className
      )}
    >
      <div className="flex h-16 items-center justify-between gap-2 border-b border-border px-5">
        <Link
          href={role === 'admin' ? '/dashboard' : '/referrals'}
          className="group flex min-w-0 items-center gap-2.5 no-underline"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-sm font-bold text-white shadow-sm">
            R
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-foreground">Referrio</span>
            <span className="truncate text-[11px] text-foreground-subtle">AFC · AHA Network</span>
          </span>
        </Link>
        <NotificationBell session={session} />
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4">
        {sections.map((section) => (
          <div key={section.label} className="mb-4 last:mb-0">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
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
                        'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium no-underline transition',
                        active
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground'
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-primary-600"
                        />
                      )}
                      <Icon
                        aria-hidden
                        className={cn(
                          'h-4 w-4 shrink-0',
                          active ? 'text-primary-600' : 'text-foreground-subtle group-hover:text-foreground'
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
    <div className="relative border-t border-border p-3">
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
      >
        <Avatar name={name} highlighted size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-[11px] text-foreground-subtle">
            <RoleLabel role={role} />
          </p>
        </div>
      </button>
      {menuOpen && (
        <div
          className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-md border border-border bg-surface-raised shadow-raised animate-fade-in"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition hover:bg-surface-muted"
          >
            <LogOut className="h-4 w-4 text-foreground-subtle" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
