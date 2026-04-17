import { Types } from 'mongoose';
import { formatNotificationContent } from '@/lib/format-notification-content';
import { Notification } from '@/models/notification';
import { User } from '@/models/user';

type NotificationType =
  | 'note'
  | 'status_change'
  | 'email_response'
  | 'update_request_response'
  | 'nps_survey_completed'
  | 'checkin_no_response_24h'
  | 'referral_created';

interface CreateNotificationParams {
  type: NotificationType;
  referralId: Types.ObjectId | string;
  borrowerName: string;
  actorRole: string;
  actorName: string;
  content: string;
}

/**
 * Creates notifications for specific users by their user IDs
 */
export async function createNotificationsForUsers(
  userIds: (Types.ObjectId | string)[],
  {
    type,
    referralId,
    borrowerName,
    actorRole,
    actorName,
    content,
  }: CreateNotificationParams
): Promise<void> {
  try {
    if (userIds.length === 0) {
      return;
    }

    // Normalize referralId to ObjectId
    const normalizedReferralId = 
      typeof referralId === 'string' 
        ? new Types.ObjectId(referralId) 
        : referralId;

    // Normalize user IDs to ObjectId
    const normalizedUserIds = userIds.map((id) => 
      typeof id === 'string' ? new Types.ObjectId(id) : id
    );

    // Create notification documents for each user
    const notifications = normalizedUserIds.map((userId) => ({
      userId,
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
    console.error('Failed to create notifications for users:', error);
    // Don't throw - notification creation should not break the main flow
  }
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

    // Use the new helper function
    await createNotificationsForUsers(
      adminUsers.map((admin) => admin._id as Types.ObjectId),
      { type, referralId, borrowerName, actorRole, actorName, content }
    );
  } catch (error) {
    console.error('Failed to create admin notifications:', error);
    // Don't throw - notification creation should not break the main flow
  }
}

/**
 * Creates notifications for admins and the assigned MC on a referral
 */
export async function createAdminAndMcNotifications(
  mcUserId: Types.ObjectId | string | null | undefined,
  {
    type,
    referralId,
    borrowerName,
    actorRole,
    actorName,
    content,
  }: CreateNotificationParams
): Promise<void> {
  try {
    // Find all admin users
    const adminUsers = await User.find({ role: 'admin' }).select('_id').lean();
    
    const userIds: (Types.ObjectId | string)[] = adminUsers.map((admin) => admin._id as Types.ObjectId);
    
    // Add MC user ID if provided
    if (mcUserId) {
      userIds.push(mcUserId);
    }

    if (userIds.length === 0) {
      return;
    }

    // Use the new helper function
    await createNotificationsForUsers(
      userIds,
      { type, referralId, borrowerName, actorRole, actorName, content }
    );
  } catch (error) {
    console.error('Failed to create admin and MC notifications:', error);
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
      content: formatNotificationContent(notification.content),
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
 * Mark a single notification as read by ID
 */
export async function markNotificationAsRead(notificationId: string, userId: string): Promise<boolean> {
  try {
    const result = await Notification.updateOne({
      _id: new Types.ObjectId(notificationId),
      userId: new Types.ObjectId(userId),
    }, {
      $set: { readAt: new Date() },
    });
    return result.matchedCount === 1;
  } catch (error) {
    console.error('Failed to mark notification as read:', error);
    return false;
  }
}
