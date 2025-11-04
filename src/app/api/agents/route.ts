import { NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const agents = await Agent.find({ active: true }).lean();
  return NextResponse.json(agents);
}
