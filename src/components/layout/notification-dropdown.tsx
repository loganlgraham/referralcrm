'use client';

import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';

export interface Notification {
  _id: string;
  type:
    | 'note'
    | 'status_change'
    | 'email_response'
    | 'email_delivery_failed'
    | 'update_request_response'
    | 'nps_survey_completed'
    | 'checkin_no_response_24h'
    | 'referral_created';
  referralId: string;
  borrowerName: string;
  actorRole: string;
  actorName: string;
  content: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationDropdownProps {
  notifications: Notification[];
  onClose: () => void;
  onNotificationsChanged?: () => void;
  anchorRef: RefObject<HTMLElement>;
}

const PANEL_MARGIN = 8;

export function NotificationDropdown({
  notifications: initialNotifications,
  onClose,
  onNotificationsChanged,
  anchorRef,
}: NotificationDropdownProps) {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Anchor the panel to the bell using fixed positioning so it can never be
  // clipped by the (overflow/stacking) context of the nav shell, and always
  // stays fully on screen on both desktop and mobile.
  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const width = Math.min(384, viewportWidth - PANEL_MARGIN * 2);
      // Prefer right-aligning the panel to the bell (opens leftward). If that
      // would run off the left edge (e.g. bell inside the narrow sidebar),
      // open to the right of the bell instead.
      let left = rect.right - width;
      if (left < PANEL_MARGIN) {
        left = rect.right + PANEL_MARGIN;
      }
      left = Math.max(PANEL_MARGIN, Math.min(left, viewportWidth - width - PANEL_MARGIN));
      const top = rect.bottom + PANEL_MARGIN;
      setPosition({ top, left, width });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef]);

  const unreadCount = notifications.filter((n) => n.readAt == null).length;

  // Update local state when initialNotifications changes
  useEffect(() => {
    setNotifications(initialNotifications);
  }, [initialNotifications]);

  // Close dropdown when clicking outside (ignoring the anchor so its own click
  // handler can toggle the panel closed without an immediate reopen).
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedAnchor = anchorRef.current?.contains(target);
      const clickedPanel = dropdownRef.current?.contains(target);
      if (!clickedAnchor && !clickedPanel) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, anchorRef]);

  const handleNotificationClick = async (notificationId: string, referralId: string) => {
    const clickedNotification = notifications.find((notification) => notification._id === notificationId);
    const shouldMarkAsRead = clickedNotification?.readAt == null;
    const previousNotifications = notifications;
    if (shouldMarkAsRead) {
      setNotifications((prev) =>
        prev.map((notification) =>
          notification._id === notificationId
            ? { ...notification, readAt: new Date().toISOString() }
            : notification
        )
      );
    }

    // Mark clicked notification as read
    try {
      if (shouldMarkAsRead) {
        const response = await fetch(`/api/admin/notifications/${notificationId}`, {
          method: 'PATCH',
        });
        if (!response.ok) {
          throw new Error('Failed to mark notification as read');
        }
        if (onNotificationsChanged) {
          onNotificationsChanged();
        }
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      if (shouldMarkAsRead) {
        setNotifications(previousNotifications);
      }
      if (onNotificationsChanged) {
        onNotificationsChanged();
      }
    }
    
    // Navigate to referral page
    router.push(`/referrals/${referralId}`);
    onClose();
  };

  const handleMarkAllRead = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (unreadCount === 0 || markingAllRead) {
      return;
    }

    const previousNotifications = notifications;
    const readAt = new Date().toISOString();
    setMarkingAllRead(true);
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.readAt == null ? { ...notification, readAt } : notification
      )
    );

    try {
      const response = await fetch('/api/admin/notifications/read', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to mark all notifications as read');
      }
      onNotificationsChanged?.();
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      setNotifications(previousNotifications);
      onNotificationsChanged?.();
    } finally {
      setMarkingAllRead(false);
    }
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'note':
        return '📝';
      case 'status_change':
        return '🔄';
      case 'email_response':
        return '📧';
      case 'email_delivery_failed':
        return '📪';
      case 'update_request_response':
        return '✅';
      case 'nps_survey_completed':
        return '⭐';
      case 'checkin_no_response_24h':
        return '⚠️';
      case 'referral_created':
        return '🔔';
    }

    const exhaustiveCheck: never = type;
    return exhaustiveCheck;
  };

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      ref={dropdownRef}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: position?.width
      }}
      className="fixed z-[100] rounded-lg border border-border bg-surface-raised shadow-raised"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
        {notifications.length > 0 && unreadCount > 0 ? (
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markingAllRead}
            className="shrink-0 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs font-medium text-foreground-muted shadow-sm transition hover:border-border-strong hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mark all as read
          </button>
        ) : null}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-foreground-subtle">No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((notification) => (
              <button
                key={notification._id}
                type="button"
                onClick={() => handleNotificationClick(notification._id, notification.referralId)}
                className="w-full px-4 py-3 text-left transition hover:bg-surface-muted"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">{getNotificationIcon(notification.type)}</span>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      {notification.readAt == null && (
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-danger"
                          aria-label="Unread notification"
                        />
                      )}
                      <p className={`text-sm font-semibold hover:underline ${notification.readAt == null ? 'text-primary' : 'text-foreground-muted'}`}>
                        {notification.borrowerName}
                      </p>
                    </div>
                    <p className={`mt-1 text-sm ${notification.readAt == null ? 'text-foreground' : 'text-foreground-subtle'}`}>
                      {notification.content}
                    </p>
                    <p className={`mt-1 text-xs ${notification.readAt == null ? 'text-foreground-subtle' : 'text-foreground-subtle'}`}>
                      {formatDistanceToNow(new Date(notification.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
