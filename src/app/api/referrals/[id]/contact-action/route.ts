import { differenceInMinutes } from 'date-fns';
import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { getCurrentSession } from '@/lib/auth';
import { canManageReferral } from '@/lib/rbac';
import { resolveAuditActorId } from '@/lib/server/audit';
import { logReferralActivity } from '@/lib/server/activities';
import { getReferralAppBaseUrl, verifyContactActionToken } from '@/lib/referral-links';

interface Params {
  params: { id: string };
}

const CONTACT_ACTIONS = new Set(['contact-made', 'contact-attempted']);

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  const token = request.nextUrl.searchParams.get('token');
  const hasValidToken = verifyContactActionToken(params.id, token);
  if (!session && !hasValidToken) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const action = request.nextUrl.searchParams.get('action');
  if (!action || !CONTACT_ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  await connectMongo();
  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId')
    .populate('buySideAgent', 'userId')
    .populate('sellSideAgent', 'userId')
    .populate('lender', 'userId');

  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    !hasValidToken &&
    !canManageReferral(session, {
      assignedAgent: referral.assignedAgent,
      buySideAgent: referral.buySideAgent,
      sellSideAgent: referral.sellSideAgent,
      lender: referral.lender,
      org: referral.org,
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const now = new Date();
  const previousStatusRaw = referral.status;
  const previousStatus = previousStatusRaw === 'Showing Homes' ? 'Active Lead' : previousStatusRaw;
  const previousStatusUpdatedAt = referral.statusLastUpdated instanceof Date
    ? referral.statusLastUpdated
    : referral.statusLastUpdated
    ? new Date(referral.statusLastUpdated)
    : null;
  const nextStatus = 'In Communication';
  const shouldUpdateStatus = previousStatus !== nextStatus;
  const shouldUpdateCommunicationSla = action === 'contact-made';
  const sla = (referral.sla ??= {} as any);

  const pairedAt = (() => {
    if (sla.lastPairedAt) {
      const candidate = sla.lastPairedAt instanceof Date ? sla.lastPairedAt : new Date(sla.lastPairedAt);
      if (!Number.isNaN(candidate.getTime())) {
        return candidate;
      }
    }

    if (previousStatus === 'Paired' && previousStatusUpdatedAt) {
      return previousStatusUpdatedAt;
    }

    const auditEntries = Array.isArray(referral.audit) ? referral.audit : [];
    for (let index = auditEntries.length - 1; index >= 0; index -= 1) {
      const entry = auditEntries[index];
      if (entry?.field === 'status' && entry.newValue === 'Paired' && entry.timestamp) {
        const timestamp = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
        if (!Number.isNaN(timestamp.getTime())) {
          return timestamp;
        }
      }
    }

    return null;
  })();

  if (shouldUpdateStatus) {
    referral.status = nextStatus as any;
    referral.statusLastUpdated = now;
    referral.audit = referral.audit || [];
    const auditEntry: Record<string, unknown> = {
      actorRole: session?.user.role ?? 'agent',
      field: 'status',
      previousValue: previousStatus,
      newValue: nextStatus,
      timestamp: now,
    };

    const actorId = session ? resolveAuditActorId(session.user.id) : null;
    if (actorId) {
      auditEntry.actorId = actorId;
    }

    referral.audit.push(auditEntry as any);

  }

  referral.statusLastUpdated = now;

  if (pairedAt && shouldUpdateCommunicationSla) {
    const minutes = Math.max(differenceInMinutes(now, pairedAt), 0);
    const timeToContactHours = Math.round((minutes / 60) * 10) / 10;
    if (sla.timeToFirstAgentContactHours == null || sla.timeToFirstAgentContactHours !== timeToContactHours) {
      sla.timeToFirstAgentContactHours = timeToContactHours;
      sla.lastPairedAt = pairedAt;
      referral.markModified('sla');
    }
  }

  await referral.save();

  const activityContent =
    action === 'contact-made'
      ? 'Agent reported contact made with borrower via quick link.'
      : 'Agent reported attempted outreach but could not reach the borrower via quick link.';

  const auditActorId = session ? resolveAuditActorId(session.user.id) : null;
  const activityActorId =
    auditActorId ??
    (referral.assignedAgent && typeof (referral.assignedAgent as any) === 'object'
      ? ((referral.assignedAgent as any).userId ?? (referral.assignedAgent as any)._id ?? null)
      : referral.assignedAgent ?? null);
  await logReferralActivity({
    referralId: referral._id,
    actorRole: session?.user.role ?? 'agent',
    actorId: activityActorId ?? session?.user.id,
    channel: 'update',
    content: activityContent,
  });

  const baseUrl = getReferralAppBaseUrl();
  const redirectUrl = baseUrl ? `${baseUrl}/referrals/${referral._id.toString()}?action=${action}` : null;

  if (redirectUrl) {
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.json({ id: referral._id.toString(), action });
}
