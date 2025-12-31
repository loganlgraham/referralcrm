import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { deleteNotification } from '@/lib/server/notifications';

interface Params {
  params: { id: string };
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();

  const deleted = await deleteNotification(params.id, session.user.id);

  if (!deleted) {
    return new NextResponse('Notification not found', { status: 404 });
  }

  return NextResponse.json({
    success: true,
  });
}
