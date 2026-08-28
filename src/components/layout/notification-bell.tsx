'use client';

import { useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import useSWR from 'swr';
import { Session } from 'next-auth';
import { NotificationDropdown, type Notification } from './notification-dropdown';
import { cn } from '@/lib/cn';

interface NotificationBellProps {
  session: Session;
  inverted?: boolean;
}

const COUNT_POLL_MS = 120_000;
const COUNT_URL = '/api/admin/notifications?count=1';
const LIST_URL = '/api/admin/notifications';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function NotificationBell({ session, inverted = false }: NotificationBellProps) {
  const isAdmin = session.user.role === 'admin';
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const countInFlightRef = useRef(false);

  const { data: countData, mutate: mutateCount } = useSWR<{ count: number }>(
    isAdmin ? COUNT_URL : null,
    async (url: string) => {
      countInFlightRef.current = true;
      try {
        return await fetcher(url);
      } finally {
        countInFlightRef.current = false;
      }
    },
    {
      refreshInterval: () => (countInFlightRef.current ? 0 : COUNT_POLL_MS),
      dedupingInterval: COUNT_POLL_MS,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
    }
  );

  const { data: listData, mutate: mutateList } = useSWR<{
    count: number;
    notifications: Notification[];
  }>(isAdmin && isOpen ? LIST_URL : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: COUNT_POLL_MS,
  });

  if (!isAdmin) {
    return null;
  }

  const count = countData?.count ?? listData?.count ?? 0;

  const handleToggle = () => {
    setIsOpen((open) => !open);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleNotificationsChanged = () => {
    void mutateCount();
    void mutateList();
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
          notifications={listData?.notifications || []}
          onClose={handleClose}
          onNotificationsChanged={handleNotificationsChanged}
        />
      )}
    </div>
  );
}
