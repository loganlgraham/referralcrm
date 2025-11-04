import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { connectMongo } from '@/lib/mongoose';
import { User } from '@/models/user';

export const runtime = 'nodejs';

const ALLOWED = new Set(['agent', 'mortgage-consultant', 'admin']);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { role } = await req.json().catch(() => ({}));
  if (!ALLOWED.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  await connectMongo();
  const user = await User.findOne({ email: session.user.email }).select('_id role').lean();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (user.role) {
    return NextResponse.json({ error: 'Role already set' }, { status: 409 });
  }

  await User.updateOne({ _id: user._id }, { $set: { role } });
  return NextResponse.json({ ok: true });
}
