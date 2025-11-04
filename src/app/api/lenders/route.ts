import { NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const lenders = await LenderMC.find().lean();
  return NextResponse.json(lenders);
}
