import { Types } from 'mongoose';
import { Notification } from '@/models/notification';
import { User } from '@/models/user';

type NotificationType = 'note' | 'status_change' | 'email_response';

interface CreateNotificationParams {
  type: NotificationType;
  referralId: Types.ObjectId | string;
  borrowerName: string;
  actorRole: string;
  actorName: string;
  content: string;
}

/**
 * Creates notifications for all admin users
 */
export async function createAdminNotifications({
  type,
  referralId,
  borrowerName,
  actorRole,
  actorName,
  content,
}: CreateNotificationParams): Promise<void> {
  try {
    // Find all admin users
    const adminUsers = await User.find({ role: 'admin' }).select('_id').lean();
    
    if (adminUsers.length === 0) {
      return;
    }

    // Normalize referralId to ObjectId
    const normalizedReferralId = 
      typeof referralId === 'string' 
        ? new Types.ObjectId(referralId) 
        : referralId;

    // Create notification documents for each admin
    const notifications = adminUsers.map((admin) => ({
      userId: admin._id,
      type,
      referralId: normalizedReferralId,
      borrowerName,
      actorRole,
      actorName,
      content,
      readAt: null,
      createdAt: new Date(),
    }));

    // Bulk insert for efficiency
    await Notification.insertMany(notifications);
  } catch (error) {
    console.error('Failed to create admin notifications:', error);
    // Don't throw - notification creation should not break the main flow
  }
}

/**
 * Get count of unread notifications for a user
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  try {
    const count = await Notification.countDocuments({
      userId: new Types.ObjectId(userId),
      readAt: null,
    });
    return count;
  } catch (error) {
    console.error('Failed to get unread notification count:', error);
    return 0;
  }
}

interface NotificationLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  referralId: Types.ObjectId;
  borrowerName: string;
  actorRole: string;
  actorName: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Get notifications for a user
 */
export async function getNotifications(
  userId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const notifications = await Notification.find({
      userId: new Types.ObjectId(userId),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<NotificationLean[]>();

    return notifications.map((notification) => ({
      ...notification,
      _id: notification._id.toString(),
      userId: notification.userId.toString(),
      referralId: notification.referralId.toString(),
    }));
  } catch (error) {
    console.error('Failed to get notifications:', error);
    return [];
  }
}

/**
 * Mark all unread notifications as read for a user
 */
export async function markNotificationsAsRead(userId: string): Promise<number> {
  try {
    const result = await Notification.updateMany(
      {
        userId: new Types.ObjectId(userId),
        readAt: null,
      },
      {
        $set: { readAt: new Date() },
      }
    );
    return result.modifiedCount;
  } catch (error) {
    console.error('Failed to mark notifications as read:', error);
    return 0;
  }
}

/**
 * Delete a single notification by ID
 */
export async function deleteNotification(notificationId: string, userId: string): Promise<boolean> {
  try {
    const result = await Notification.deleteOne({
      _id: new Types.ObjectId(notificationId),
      userId: new Types.ObjectId(userId),
    });
    return result.deletedCount === 1;
  } catch (error) {
    console.error('Failed to delete notification:', error);
    return false;
  }
}
