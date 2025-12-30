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

  if (!npsToken) {
    return NextResponse.json({ valid: false, error: 'Invalid survey link' }, { status: 404 });
  }

  if (npsToken.submitted) {
    return NextResponse.json({ valid: false, error: 'Survey already submitted', submitted: true });
  }

  if (new Date() > new Date(npsToken.expiresAt)) {
    return NextResponse.json({ valid: false, error: 'Survey link has expired', expired: true });
  }

  // Get agent name if this is an agent survey
  let agentName: string | undefined;
  if (npsToken.type === 'agent') {
    const agent = await Agent.findById(npsToken.targetId).select('name').lean();
    agentName = agent?.name;
  }

  return NextResponse.json({
    valid: true,
    type: npsToken.type,
    recipientName: npsToken.recipientName,
    agentName,
  });
}

