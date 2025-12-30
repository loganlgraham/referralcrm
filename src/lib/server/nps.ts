import { Types } from 'mongoose';
import crypto from 'crypto';

import { connectMongo } from '@/lib/mongoose';
import { sendTransactionalEmail } from '@/lib/email';
import { NPSToken } from '@/models/nps-token';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';

export interface NPSSurveyData {
  paymentId: string;
  referralId: string;
  type: 'lender' | 'agent';
  targetId: string; // lenderId or agentId
  recipientEmail: string;
  recipientName: string;
  agentName?: string; // For borrower survey about agent
}

/**
 * Generate a secure random token for NPS survey
 */
export function generateNPSToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Create and save an NPS token
 */
export async function createNPSToken(data: NPSSurveyData): Promise<string> {
  await connectMongo();

  const token = generateNPSToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // Expires in 30 days

  await NPSToken.create({
    token,
    type: data.type,
    paymentId: new Types.ObjectId(data.paymentId),
    referralId: new Types.ObjectId(data.referralId),
    targetId: new Types.ObjectId(data.targetId),
    recipientEmail: data.recipientEmail,
    recipientName: data.recipientName,
    expiresAt,
  });

  return token;
}

/**
 * Send NPS survey email
 */
export async function sendNPSSurveyEmail(
  data: NPSSurveyData,
  token: string,
  origin: string
): Promise<boolean> {
  const surveyUrl = `${origin}/nps/${data.type}?token=${token}`;

  const question =
    data.type === 'lender'
      ? 'On a scale of 0-10, how likely are you to recommend American Financing to a client or colleague?'
      : `On a scale of 0-10, how likely are you to recommend ${data.agentName || 'this agent'} to a client or colleague?`;

  const firstName = data.recipientName.split(' ')[0] || data.recipientName;

  const html = `
    <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 640px; color: #0f172a; line-height: 1.5;">
      <h2 style="font-size: 20px; margin-bottom: 8px;">Help us improve</h2>
      <p style="margin: 0 0 12px 0;">Hi ${firstName},</p>
      <p style="margin: 0 0 12px 0;">${question}</p>
      <p style="margin: 12px 0 0 0;">
        <a href="${surveyUrl}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #0f172a; color: #fff; font-weight: 700; text-decoration: none;">
          Take the survey
        </a>
      </p>
      <p style="margin: 12px 0 0 0; font-size: 14px; color: #64748b;">
        This link will expire in 30 days.
      </p>
    </div>
  `;

  const text = `
Help us improve

Hi ${firstName},

${question}

Take the survey: ${surveyUrl}

This link will expire in 30 days.
  `.trim();

  return sendTransactionalEmail({
    to: [data.recipientEmail],
    subject: 'How likely are you to recommend us?',
    html,
    text,
  });
}

/**
 * Calculate NPS from a set of scores
 * NPS = (Promoter% - Detractor%) * 100
 * Promoters: 9-10, Passives: 7-8, Detractors: 0-6
 */
function calculateNPS(scores: number[]): number | null {
  if (scores.length === 0) {
    return null;
  }

  const totalResponses = scores.length;
  const promoterCount = scores.filter((s) => s >= 9).length;
  const detractorCount = scores.filter((s) => s <= 6).length;

  const promoterPercentage = (promoterCount / totalResponses) * 100;
  const detractorPercentage = (detractorCount / totalResponses) * 100;

  const nps = promoterPercentage - detractorPercentage;

  return nps;
}

/**
 * Update NPS score for agent or lender
 */
export async function updateNPSScore(
  type: 'lender' | 'agent',
  targetId: string,
  newScore: number
): Promise<void> {
  await connectMongo();

  // Get all submitted scores for this target
  const submittedTokens = await NPSToken.find({
    type,
    targetId: new Types.ObjectId(targetId),
    submitted: true,
    score: { $ne: null },
  })
    .select('score')
    .lean<{ score: number }[]>();

  // Extract scores
  const scores = submittedTokens
    .map((t) => t.score)
    .filter((s): s is number => typeof s === 'number' && s >= 0 && s <= 10);

  // Calculate NPS using the correct formula
  const nps = calculateNPS(scores);

  // Update the agent or lender
  if (type === 'agent') {
    await Agent.findByIdAndUpdate(targetId, { npsScore: nps });
  } else {
    await LenderMC.findByIdAndUpdate(targetId, { npsScore: nps });
  }
}

/**
 * Send NPS surveys when a deal is closed
 */
export async function sendNPSSurveysForClosedDeal(
  paymentId: string,
  referralId: string,
  usedAfc: boolean,
  origin: string
): Promise<void> {
  await connectMongo();

  const { Referral } = await import('@/models/referral');
  const { Payment } = await import('@/models/payment');

  // Get referral with populated fields
  const referral = await Referral.findById(referralId)
    .populate('assignedAgent', 'name email')
    .populate('lender', 'name email')
    .lean<{
      assignedAgent?: { _id?: any; name?: string; email?: string } | null;
      lender?: { _id?: any; name?: string; email?: string } | null;
      borrower?: { email?: string; name?: string; firstName?: string } | null;
    } | null>();

  if (!referral) return;

  const payment = await Payment.findById(paymentId).lean();
  if (!payment) return;

  // 1. Send lender survey to agent if usedAfc is true
  if (usedAfc && referral.assignedAgent && referral.lender) {
    const agent = referral.assignedAgent as any;
    const lender = referral.lender as any;

    if (agent.email && lender._id) {
      const token = await createNPSToken({
        paymentId,
        referralId,
        type: 'lender',
        targetId: lender._id.toString(),
        recipientEmail: agent.email,
        recipientName: agent.name || 'Agent',
      });

      await sendNPSSurveyEmail(
        {
          paymentId,
          referralId,
          type: 'lender',
          targetId: lender._id.toString(),
          recipientEmail: agent.email,
          recipientName: agent.name || 'Agent',
        },
        token,
        origin
      );
    }
  }

  // 2. Send agent survey to borrower
  if (referral.assignedAgent && referral.borrower?.email) {
    const agent = referral.assignedAgent as any;
    const borrowerEmail = referral.borrower.email;
    const borrowerName = referral.borrower.name || referral.borrower.firstName || 'Client';
    const agentId = agent._id?.toString() || (typeof agent === 'string' ? agent : null);

    if (agentId) {
      // Get full agent name from database
      const { Agent } = await import('@/models/agent');
      const agentDoc = await Agent.findById(agentId)
        .select('name')
        .lean<{ name?: string } | null>();
      const agentFullName = agentDoc?.name || (agent as any).name || 'this agent';

      const token = await createNPSToken({
        paymentId,
        referralId,
        type: 'agent',
        targetId: agentId,
        recipientEmail: borrowerEmail,
        recipientName: borrowerName,
        agentName: agentFullName,
      });

      await sendNPSSurveyEmail(
        {
          paymentId,
          referralId,
          type: 'agent',
          targetId: agentId,
          recipientEmail: borrowerEmail,
          recipientName: borrowerName,
          agentName: agentFullName,
        },
        token,
        origin
      );
    }
  }
}

