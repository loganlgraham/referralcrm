import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { connectMongo } from '@/lib/mongoose';
import { User } from '@/models/user';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';

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
  const user = await User.findOne({ email: session.user.email })
    .select('_id role name email')
    .lean<{ _id: any; role?: string | null; name?: string | null; email: string }>();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (user?.role) {
    return NextResponse.json({ error: 'Role already set' }, { status: 409 });
  }

  await User.updateOne({ _id: user._id }, { $set: { role } });

  try {
    if (role === 'agent') {
      await Agent.findOneAndUpdate(
        { $or: [{ userId: user._id }, { email: user.email }] },
        {
          userId: user._id,
          name: session.user.name ?? user.name ?? '',
          email: user.email,
          phone: '',
          statesLicensed: [],
          zipCoverage: [],
          closings12mo: 0,
          closingRatePercentage: null,
          npsScore: null,
          avgResponseHours: null,
          active: true,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else if (role === 'mortgage-consultant') {
      await LenderMC.findOneAndUpdate(
        { $or: [{ userId: user._id }, { email: user.email }] },
        {
          userId: user._id,
          name: session.user.name ?? user.name ?? '',
          email: user.email,
          phone: '',
          nmlsId: '',
          licensedStates: [],
          team: '',
          region: '',
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  } catch (error) {
    console.error('Failed to provision profile for role selection', error);
  }

  return NextResponse.json({ ok: true });
}
