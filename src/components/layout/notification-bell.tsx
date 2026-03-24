'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import useSWR from 'swr';
import { Session } from 'next-auth';
import { NotificationDropdown } from './notification-dropdown';

interface NotificationBellProps {
  session: Session;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function NotificationBell({ session }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  
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
        type="button"
        onClick={handleToggle}
        className="relative rounded-md p-2 text-slate-600 transition hover:bg-slate-100 focus:outline-none"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <NotificationDropdown
          notifications={data?.notifications || []}
          onClose={handleClose}
          onNotificationsChanged={handleNotificationsChanged}
        />
      )}
    </div>
  );
}
