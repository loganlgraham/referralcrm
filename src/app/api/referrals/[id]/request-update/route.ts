import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession, requireAdmin } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { logReferralActivity } from '@/lib/server/activities';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { renderManualUpdateRequestEmail } from '@/lib/email-templates/update-request';
import { getAppOrigin } from '@/lib/server/app-origin';

interface Params {
  params: { id: string };
}

interface AgentContact {
  _id: string;
  name: string;
  email: string;
}

interface ReferralLean {
  _id: unknown;
  borrower: {
    name: string;
    email: string;
    phone: string;
  };
  loanFileNumber?: string;
  status: string;
  statusLastUpdated?: Date;
  propertyAddress?: string;
  lookingInZip?: string;
  lender?: {
    name?: string;
    email?: string;
    phone?: string;
  } | null;
}

/**
 * POST /api/referrals/[id]/request-update
 * Send update request emails to selected agents
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    const body = await request.json();
    const { agentIds, isAutomated = false } = body as {
      agentIds: string[];
      isAutomated?: boolean;
    };

    // Authenticate: require admin for manual requests, allow system for automated
    if (!isAutomated) {
      await requireAdmin();
    }

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return NextResponse.json({ error: 'agentIds array is required' }, { status: 400 });
    }

    if (!isTransactionalEmailConfigured()) {
      return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
    }

    await connectMongo();

    // Fetch referral with populated agents and lender
    const referral = await Referral.findById(params.id)
      .populate('assignedAgent', 'name email')
      .populate('buySideAgent', 'name email')
      .populate('sellSideAgent', 'name email')
      .populate('lender', 'name email phone')
      .lean<ReferralLean | null>();

    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    // Fetch selected agents
    const agents = await Agent.find({ _id: { $in: agentIds } })
      .select('_id name email')
      .lean<AgentContact[]>();

    if (agents.length === 0) {
      return NextResponse.json({ error: 'No valid agents found' }, { status: 400 });
    }

    // Get app origin for links
    const appOrigin = getAppOrigin(request);
    const referralUrl = `${appOrigin}/referrals/${params.id}`;

    // Calculate days in current status
    const daysInStatus = referral.statusLastUpdated
      ? Math.floor((Date.now() - new Date(referral.statusLastUpdated).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    // Send emails to each agent
    const emailResults: { sent: string[]; failed: string[] } = {
      sent: [],
      failed: [],
    };

    // Helper to extract first name from full name
    const getFirstName = (fullName: string): string => {
      const [first] = fullName.trim().split(/\s+/);
      return first || fullName;
    };

    // Get lender contact info
    const lender = referral.lender && typeof referral.lender === 'object' ? referral.lender : null;
    const lenderName = lender?.name || 'Not provided';
    const lenderEmail = lender?.email || 'Not provided';
    const lenderPhone = lender?.phone || 'Not provided';

    for (const agent of agents) {
      if (!agent.email) {
        console.warn(`Agent ${agent.name} (${agent._id}) has no email address`);
        emailResults.failed.push(agent.name);
        continue;
      }

      const agentFirstName = getFirstName(agent.name);
      const buyerName = referral.borrower.name;
      const buyerFirstName = getFirstName(buyerName);
      const { html, text } = renderManualUpdateRequestEmail({
        agentFirstName,
        buyerFirstName,
        buyerName,
        referralUrl,
        contacts: {
          buyerName,
          buyerEmail: referral.borrower.email,
          buyerPhone: referral.borrower.phone,
          status: referral.status,
          lenderName,
          lenderEmail,
          lenderPhone,
          loanFileNumber: referral.loanFileNumber || 'N/A',
        },
      });

      const delivered = await sendTransactionalEmail({
        to: [agent.email],
        subject: `Action Needed: Update requested for ${buyerName}`,
        html,
        text,
      });

      if (delivered) {
        emailResults.sent.push(agent.name);
      } else {
        emailResults.failed.push(agent.name);
      }
    }

    const timestampField = isAutomated ? 'lastAutoReminderSentAt' : 'lastManualReminderSentAt';
    const now = new Date();
    const hasSuccessfulSend = emailResults.sent.length > 0;

    if (hasSuccessfulSend) {
      await Referral.findByIdAndUpdate(params.id, {
        $set: { [timestampField]: now },
        $push: {
          audit: {
            actorId: session?.user?.id || null,
            actorRole: isAutomated ? 'system' : session?.user?.role || 'admin',
            field: isAutomated ? 'auto_update_reminder' : 'update_requested',
            previousValue: null,
            newValue: agentIds,
            timestamp: now,
          },
        },
      });

      const deliveredNames = emailResults.sent.join(', ');
      const activityContent = isAutomated
        ? `Automated update reminder sent to ${deliveredNames}`
        : `Update request sent to ${deliveredNames}`;

      await logReferralActivity({
        referralId: params.id,
        actorRole: isAutomated ? 'system' : session?.user?.role,
        actorId: isAutomated ? null : session?.user?.id,
        channel: 'email',
        content: activityContent,
      });
    }

    return NextResponse.json({
      success: true,
      sent: emailResults.sent,
      failed: emailResults.failed,
      timestamp: hasSuccessfulSend ? now.toISOString() : null,
    });
  } catch (error) {
    console.error('Error sending update request emails:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send emails' },
      { status: 500 }
    );
  }
}
