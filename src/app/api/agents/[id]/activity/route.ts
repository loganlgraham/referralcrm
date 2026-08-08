import { formatInTimeZone } from 'date-fns-tz';
import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { getCurrentSession } from '@/lib/auth';
import { getAgentActivityEntries } from '@/lib/server/agent-activity';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

interface Params {
  params: { id: string };
}

const escapeCsvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const canViewAgentActivity = async (
  agentId: string,
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>
): Promise<{ allowed: boolean; agentName: string }> => {
  if (!Types.ObjectId.isValid(agentId)) {
    return { allowed: false, agentName: 'agent' };
  }

  await connectMongo();
  const agent = await Agent.findById(agentId)
    .select('name userId')
    .lean<{ name?: string | null; userId?: Types.ObjectId | null } | null>();
  if (!agent) {
    return { allowed: false, agentName: 'agent' };
  }

  const role = session.user.role;
  const allowed =
    role === 'admin' ||
    role === 'mc' ||
    (role === 'agent' && agent.userId?.toString() === session.user.id);
  return { allowed, agentName: agent.name?.trim() || 'agent' };
};

export async function GET(request: NextRequest, { params }: Params) {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const access = await canViewAgentActivity(params.id, session);
  if (!access.allowed) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const wantsCsv = request.nextUrl.searchParams.get('format') === 'csv';
  const entries = await getAgentActivityEntries(params.id, wantsCsv ? undefined : 5);
  if (!entries) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (!wantsCsv) {
    return NextResponse.json(entries);
  }

  const rows = [
    ['Date/Time (MT)', 'Action', 'Details', 'Client', 'Loan File Number', 'Referral ID'],
    ...entries.map((entry) => [
      formatInTimeZone(new Date(entry.createdAt), SLA_TIME_ZONE, "yyyy-MM-dd h:mm a 'MT'"),
      entry.action,
      entry.content,
      entry.referral?.borrowerName ?? '',
      entry.referral?.loanFileNumber ?? '',
      entry.referral?.id ?? '',
    ]),
  ];
  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  const safeName = access.agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName || 'agent'}-activity-log.csv"`,
    },
  });
}
