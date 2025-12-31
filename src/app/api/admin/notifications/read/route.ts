import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { markNotificationsAsRead } from '@/lib/server/notifications';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();

  const modifiedCount = await markNotificationsAsRead(session.user.id);

  return NextResponse.json({
    success: true,
    modifiedCount,
  });
}
