'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  _id: string;
  type: 'note' | 'status_change' | 'email_response' | 'update_request_response' | 'nps_survey_completed';
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
  onNotificationDeleted?: () => void;
}

export function NotificationDropdown({
  notifications: initialNotifications,
  onClose,
  onNotificationDeleted,
}: NotificationDropdownProps) {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  // Update local state when initialNotifications changes
  useEffect(() => {
    setNotifications(initialNotifications);
  }, [initialNotifications]);

  // Mark notifications as read when dropdown opens (this removes the red dot)
  useEffect(() => {
    const markAsRead = async () => {
      try {
        await fetch('/api/admin/notifications/read', {
          method: 'POST',
        });
        // Refresh notification list after marking as read to update the count
        if (onNotificationDeleted) {
          onNotificationDeleted();
        }
      } catch (error) {
        console.error('Failed to mark notifications as read:', error);
      }
    };

    markAsRead();
  }, [onNotificationDeleted]);

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
    // Optimistically remove the notification from the list
    const deletedNotification = notifications.find((n) => n._id === notificationId);
    setNotifications((prev) => prev.filter((n) => n._id !== notificationId));
    
    // Delete the notification when clicked
    try {
      await fetch(`/api/admin/notifications/${notificationId}`, {
        method: 'DELETE',
      });
      // Refresh notification list to update the count
      if (onNotificationDeleted) {
        onNotificationDeleted();
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
      // If deletion failed, restore the notification
      if (deletedNotification) {
        setNotifications((prev) => 
          [...prev, deletedNotification].sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
        );
      } else {
        // If we can't restore, refresh from server
        if (onNotificationDeleted) {
          onNotificationDeleted();
        }
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
      default:
        return '🔔';
    }
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
                    <p className="text-sm font-semibold text-brand hover:underline">
                      {notification.borrowerName}
                    </p>
                    <p className="mt-1 text-sm text-slate-900">{notification.content}</p>
                    <p className="mt-1 text-xs text-slate-500">
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
