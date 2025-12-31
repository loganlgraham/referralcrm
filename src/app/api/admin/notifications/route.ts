import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { getUnreadNotificationCount, getNotifications } from '@/lib/server/notifications';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();

  const [count, notifications] = await Promise.all([
    getUnreadNotificationCount(session.user.id),
    getNotifications(session.user.id, 50),
  ]);

  return NextResponse.json({
    count,
    notifications,
  });
}
