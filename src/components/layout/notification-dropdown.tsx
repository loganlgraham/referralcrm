'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  _id: string;
  type: 'note' | 'status_change' | 'email_response' | 'update_request_response' | 'nps_survey_completed' | 'checkin_no_response_48h';
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
}

export function NotificationDropdown({
  notifications: initialNotifications,
  onClose,
  onNotificationsChanged,
}: NotificationDropdownProps) {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  // Update local state when initialNotifications changes
  useEffect(() => {
    setNotifications(initialNotifications);
  }, [initialNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleNotificationClick = async (notificationId: string, referralId: string) => {
    const clickedNotification = notifications.find((notification) => notification._id === notificationId);
    const shouldMarkAsRead = clickedNotification?.readAt === null;
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

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'note':
        return '📝';
      case 'status_change':
        return '🔄';
      case 'email_response':
        return '📧';
      case 'update_request_response':
        return '✅';
      case 'nps_survey_completed':
        return '⭐';
      case 'checkin_no_response_48h':
        return '⚠️';
    }

    const exhaustiveCheck: never = type;
    return exhaustiveCheck;
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-slate-200 bg-white shadow-lg sm:w-80 md:left-full md:right-auto md:ml-2 md:w-96"
    >
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-500">No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((notification) => (
              <button
                key={notification._id}
                type="button"
                onClick={() => handleNotificationClick(notification._id, notification.referralId)}
                className="w-full px-4 py-3 text-left transition hover:bg-slate-50"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">{getNotificationIcon(notification.type)}</span>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      {notification.readAt === null && (
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-red-500"
                          aria-label="Unread notification"
                        />
                      )}
                      <p className={`text-sm font-semibold hover:underline ${notification.readAt === null ? 'text-brand' : 'text-slate-600'}`}>
                        {notification.borrowerName}
                      </p>
                    </div>
                    <p className={`mt-1 text-sm ${notification.readAt === null ? 'text-slate-900' : 'text-slate-500'}`}>
                      {notification.content}
                    </p>
                    <p className={`mt-1 text-xs ${notification.readAt === null ? 'text-slate-500' : 'text-slate-400'}`}>
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
    </div>
  );
}
