'use client';

import { useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import useSWR from 'swr';
import { Session } from 'next-auth';
import { NotificationDropdown } from './notification-dropdown';
import { cn } from '@/lib/cn';

interface NotificationBellProps {
  session: Session;
  inverted?: boolean;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function NotificationBell({ session, inverted = false }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  // Only render for admin users
  if (session.user.role !== 'admin') {
    return null;
  }

  const { data, mutate } = useSWR<{ count: number; notifications: any[] }>(
    '/api/admin/notifications',
    fetcher,
    {
      refreshInterval: 30000, // Poll every 30 seconds
      revalidateOnFocus: true,
    }
  );

  const count = data?.count || 0;

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleNotificationsChanged = () => {
    // Refresh data when notification read state changes
    mutate();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={cn(
          'relative rounded-md p-2 transition focus-visible:outline-none focus-visible:ring-2',
          inverted
            ? 'text-white/60 hover:bg-white/10 hover:text-white focus-visible:ring-white/40'
            : 'text-foreground-muted hover:bg-surface-muted focus-visible:ring-ring/40'
        )}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-white ring-2 ring-surface-raised">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <NotificationDropdown
          anchorRef={buttonRef}
          notifications={data?.notifications || []}
          onClose={handleClose}
          onNotificationsChanged={handleNotificationsChanged}
        />
      )}
    </div>
  );
}
