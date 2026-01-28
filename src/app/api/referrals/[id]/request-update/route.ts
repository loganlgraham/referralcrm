import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession, requireAdmin } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { logReferralActivity } from '@/lib/server/activities';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
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

      const emailHtml = `
<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:640px;color:#0f172a;line-height:1.6;">
  <p style="margin:0 0 8px 0;">Hi ${agentFirstName},</p>
  
  <p style="margin:0 0 16px 0;">Hope everything's going well with ${buyerFirstName}. When you have a moment, please log in to the referral portal to add a brief update and confirm the current status. Quick notes like "showing homes this weekend," "submitting an offer," or "still in touch but pausing for now" help us stay aligned and best support the client.</p>
  
  <!-- Buyer Info Section -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:#0f172a;">Buyer Info</h3>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Buyer:</strong> ${buyerName}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Email:</strong> ${referral.borrower.email}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Phone:</strong> ${referral.borrower.phone}</div>
    <div><strong style="color:#64748b;">Current Status:</strong> ${referral.status}</div>
  </div>
  
  <!-- Mortgage Consultant at AFC Section -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:#0f172a;">Mortgage Consultant at AFC</h3>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Name:</strong> ${lenderName}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Email:</strong> ${lenderEmail}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Phone:</strong> ${lenderPhone}</div>
    <div><strong style="color:#64748b;">File Number:</strong> ${referral.loanFileNumber || 'N/A'}</div>
  </div>
  
  <!-- Agent Relationship Coordinator Section -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:#0f172a;">Agent Relationship Coordinator</h3>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Name:</strong> Kristen Truong</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Email:</strong> kristen.truong@americanhomeagents.com</div>
    <div><strong style="color:#64748b;">Phone:</strong> 303-557-4230</div>
  </div>
  
  <p style="margin:16px 0;">Please log in to update the status and add any relevant notes:</p>
  
  <a href="${referralUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;border-radius:8px;background:#0f172a;color:#fff;font-weight:600;text-decoration:none;">View Referral</a>
  
  <p style="margin:16px 0 0 0;color:#64748b;font-size:14px;">Thanks,<br>Referral CRM Team</p>
</div>
      `.trim();

      const emailText = `
Action Needed: Update requested for ${buyerName}

Hi ${agentFirstName},

Hope everything's going well with ${buyerFirstName}. When you have a moment, please log in to the referral portal to add a brief update and confirm the current status. Quick notes like "showing homes this weekend," "submitting an offer," or "still in touch but pausing for now" help us stay aligned and best support the client.

Buyer Info
Buyer: ${buyerName}
Email: ${referral.borrower.email}
Phone: ${referral.borrower.phone}
Current Status: ${referral.status}

Mortgage Consultant at AFC
Name: ${lenderName}
Email: ${lenderEmail}
Phone: ${lenderPhone}
File Number: ${referral.loanFileNumber || 'N/A'}

Agent Relationship Coordinator
Name: Kristen Truong
Email: kristen.truong@americanhomeagents.com
Phone: 303-557-4230

Please log in to update the status and add any relevant notes:
${referralUrl}

Thanks,
Referral CRM Team
      `.trim();

      const delivered = await sendTransactionalEmail({
        to: [agent.email],
        subject: `Action Needed: Update requested for ${buyerName}`,
        html: emailHtml,
        text: emailText,
      });

      if (delivered) {
        emailResults.sent.push(agent.name);
      } else {
        emailResults.failed.push(agent.name);
      }
    }

    // Update timestamp based on whether it's automated or manual
    const timestampField = isAutomated ? 'lastAutoReminderSentAt' : 'lastManualReminderSentAt';
    const now = new Date();

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

    // Log activity
    const actorRole = isAutomated ? 'system' : session?.user?.role;
    const actorId = isAutomated ? null : session?.user?.id;
    const agentNames = agents.map((a) => a.name).join(', ');
    const activityContent = isAutomated
      ? `Automated update reminder sent to ${agentNames}`
      : `Update request sent to ${agentNames}`;

    await logReferralActivity({
      referralId: params.id,
      actorRole,
      actorId,
      channel: 'email',
      content: activityContent,
    });

    return NextResponse.json({
      success: true,
      sent: emailResults.sent,
      failed: emailResults.failed,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error('Error sending update request emails:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send emails' },
      { status: 500 }
    );
  }
}
