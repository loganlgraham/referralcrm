import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { NPSToken } from '@/models/nps-token';
import { Agent } from '@/models/agent';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  await connectMongo();

  const npsToken = await NPSToken.findOne({ token }).lean();

  if (!npsToken || npsToken.type !== 'agent') {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }

  const agent = await Agent.findById(npsToken.targetId).select('name').lean();

  return NextResponse.json({
    agentName: agent?.name || 'this agent',
  });
}

