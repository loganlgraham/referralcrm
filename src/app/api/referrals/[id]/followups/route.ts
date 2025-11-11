import { NextRequest, NextResponse } from 'next/server';
import { differenceInDays, format } from 'date-fns';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { canViewReferral } from '@/lib/rbac';
import '@/models/agent';
import '@/models/lender';
import { Payment } from '@/models/payment';
import { Referral, ReferralDocument } from '@/models/referral';

interface RouteContext {
  params: { id: string };
}

const MAX_NOTES = 4;
const MAX_NOTE_LENGTH = 400;
const MAX_PAYMENTS = 3;

const systemPrompt = `You are an assistant that creates proactive outreach tasks for an operations admin supporting a real estate referral pipeline.
Use only the provided context and emphasize coordination with assigned agents, mortgage consultants (MCs), and the borrower/referral client.
Always respond with valid JSON using this schema:
{
  "generatedAt": string,             // ISO timestamp when the plan was generated
  "tasks": [
    {
      "audience": "Agent" | "MC" | "Referral",
      "title": string,               // 3-8 words, action oriented
      "summary": string,             // 1-2 sentences describing why and what to cover
      "suggestedChannel": "Phone" | "Email" | "Text" | "Internal",
      "urgency": "Low" | "Medium" | "High"
    }
  ]
}
Requirements:
- Provide 4-6 total tasks.
- Include at least one task for each audience: Agent, MC, and Referral.
- Prioritize outreach that unblocks the deal, clarifies next steps, or nudges stakeholders toward progress.
- Reference concrete data points from the context when possible (status, payments, deadlines, notes).
- Keep tone professional and collaborative.`;

const defaultModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

type NormalizedTask = {
  audience: 'Agent' | 'MC' | 'Referral';
  title: string;
  summary: string;
  suggestedChannel: 'Phone' | 'Email' | 'Text' | 'Internal';
  urgency: 'Low' | 'Medium' | 'High';
};

function buildFallbackTasks(
  referral: ReferralDocument & {
    assignedAgent?: { _id: string; name?: string | null } | null;
    lender?: { _id: string; name?: string | null } | null;
  },
  daysInStatus: number,
  reason?: string
): { generatedAt: string; tasks: NormalizedTask[]; meta: { source: 'fallback'; reason: string } } {
  const borrowerName = referral.borrower?.name?.trim() || 'the borrower';
  const agentName = referral.assignedAgent?.name?.trim() || 'the assigned agent';
  const lenderName = referral.lender?.name?.trim() || 'the mortgage consultant';
  const status = referral.status ?? 'Unknown';
  const stage = referral.stageOnTransfer?.trim() || 'Not provided';
  const location = referral.lookingInZip?.trim() || referral.propertyAddress?.trim() || 'the target market';

  const urgencyFromDays = daysInStatus > 21 ? 'High' : daysInStatus > 7 ? 'Medium' : 'Low';

  const tasks: NormalizedTask[] = [
    {
      audience: 'Agent',
      title: 'Confirm immediate next milestone',
      summary: `Touch base with ${agentName} about the current "${status}" status and capture the next dated milestone so operations can support.`,
      suggestedChannel: 'Email',
      urgency: urgencyFromDays,
    },
    {
      audience: 'MC',
      title: 'Verify financing readiness',
      summary: `Check with ${lenderName} on underwriting progress and whether any borrower documents are blocking movement toward closing.`,
      suggestedChannel: 'Phone',
      urgency: urgencyFromDays === 'Low' ? 'Medium' : urgencyFromDays,
    },
    {
      audience: 'Referral',
      title: 'Clarify borrower questions',
      summary: `Reach out to ${borrowerName} to recap the plan for the ${stage} stage and answer any outstanding questions about homes in ${location}.`,
      suggestedChannel: 'Phone',
      urgency: urgencyFromDays,
    },
    {
      audience: 'Agent',
      title: 'Update CRM timeline entry',
      summary: 'Ask the agent to log any recent showings, offers, or communications so the team has an accurate shared history.',
      suggestedChannel: 'Internal',
      urgency: 'Medium',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    tasks,
    meta: {
      source: 'fallback',
      reason: reason ?? 'Using baseline outreach suggestions because the AI plan was unavailable.',
    },
  };
}

function toCurrencyString(cents?: number | null) {
  if (typeof cents !== 'number' || Number.isNaN(cents)) {
    return 'Not provided';
  }
  const dollars = cents / 100;
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function sanitizeNoteContent(content: unknown) {
  if (typeof content !== 'string') {
    return '';
  }
  const trimmed = content.trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, MAX_NOTE_LENGTH);
}

export async function POST(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  await connectMongo();
  const referral = await Referral.findById(context.params.id)
    .populate('assignedAgent', 'name email phone')
    .populate('lender', 'name email phone')
    .lean<
      ReferralDocument & {
        assignedAgent?: { _id: string; name?: string; email?: string; phone?: string } | null;
        lender?: { _id: string; name?: string; email?: string; phone?: string } | null;
      }
    >();

  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    !canViewReferral(session, {
      assignedAgent: referral.assignedAgent ?? undefined,
      lender: referral.lender ?? undefined,
      org: referral.org,
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const payments = await Payment.find({ referralId: referral._id }).sort({ createdAt: -1 }).lean();

  const daysInStatus = differenceInDays(new Date(), referral.statusLastUpdated ?? referral.createdAt);
  const viewerRole = session.user?.role ?? 'viewer';

  const visibleNotes = (referral.notes ?? [])
    .filter((note) => {
      if (viewerRole === 'agent' && note.hiddenFromAgent) {
        return false;
      }
      if (viewerRole === 'mc' && note.hiddenFromMc) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return bTime - aTime;
    })
    .slice(0, MAX_NOTES)
    .map((note) => {
      const createdAt = note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt);
      const formattedDate = Number.isNaN(createdAt.getTime()) ? 'Unknown date' : format(createdAt, 'MMM d, yyyy h:mm a');
      return `${formattedDate} — ${note.authorName ?? 'Unknown author'} (${note.authorRole ?? 'role unknown'}): ${sanitizeNoteContent(
        note.content
      )}`;
    });

  const paymentSummaries = payments.slice(0, MAX_PAYMENTS).map((payment) => {
    const createdAt = payment.createdAt instanceof Date ? payment.createdAt : payment.createdAt ? new Date(payment.createdAt) : null;
    const createdLabel = createdAt && !Number.isNaN(createdAt.getTime()) ? format(createdAt, 'MMM d, yyyy') : 'Date unknown';
    const expected = toCurrencyString(payment.expectedAmountCents ?? null);
    const received = toCurrencyString(payment.receivedAmountCents ?? null);
    return `${createdLabel} — status: ${payment.status ?? 'unknown'}, expected: ${expected}, received: ${received}`;
  });

  const contextLines = [
    'Deal Overview:',
    `- Borrower: ${referral.borrower?.name ?? 'Unknown'} (email: ${referral.borrower?.email ?? 'unknown'}, phone: ${referral.borrower?.phone ?? 'unknown'})`,
    `- Client type: ${referral.clientType ?? 'Unknown'}`,
    `- Source: ${referral.source ?? 'Unknown'}${referral.endorser ? `, endorser: ${referral.endorser}` : ''}`,
    `- Assigned agent: ${referral.assignedAgent?.name ?? 'Unassigned'}${referral.assignedAgent?.email ? ` (${referral.assignedAgent.email})` : ''}`,
    `- Lender / MC: ${referral.lender?.name ?? 'Not set'}`,
    `- Current status: ${referral.status ?? 'Unknown'} (days in status: ${daysInStatus})`,
    `- Stage on transfer: ${referral.stageOnTransfer?.trim() || 'Not provided'}`,
    `- Looking in ZIP: ${referral.lookingInZip ?? 'Not provided'}`,
    `- Property address: ${referral.propertyAddress?.trim() || 'Not provided'}`,
    `- Org / bucket: ${referral.org ?? 'AFC'}${referral.ahaBucket ? ` (${referral.ahaBucket})` : ''}`,
    '',
    'Financial Snapshot:',
    `- Pre-approval amount: ${toCurrencyString(referral.preApprovalAmountCents ?? null)}`,
    `- Estimated purchase price: ${toCurrencyString(referral.estPurchasePriceCents ?? null)}`,
    `- Referral fee due: ${toCurrencyString(referral.referralFeeDueCents ?? null)}`,
    `- Agent commission basis points: ${typeof referral.commissionBasisPoints === 'number' ? `${referral.commissionBasisPoints} bps` : 'Not provided'}`,
    `- Referral fee basis points: ${typeof referral.referralFeeBasisPoints === 'number' ? `${referral.referralFeeBasisPoints} bps` : 'Not provided'}`,
  ];

  if (paymentSummaries.length > 0) {
    contextLines.push('', 'Recent Payments:', ...paymentSummaries);
  }

  if (visibleNotes.length > 0) {
    contextLines.push('', 'Recent Notes:', ...visibleNotes);
  }

  const userPrompt = `${contextLines.join('\n')}`;

  if (!apiKey) {
    return NextResponse.json(
      buildFallbackTasks(referral, daysInStatus, 'OpenAI API key is not configured on the server.'),
      { status: 200 }
    );
  }

  const completionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: defaultModel,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  }).catch((error) => {
    console.error('Failed to reach OpenAI for follow-up tasks', error);
    return null;
  });

  if (!completionResponse) {
    return NextResponse.json(
      buildFallbackTasks(referral, daysInStatus, 'Unable to reach OpenAI. Showing baseline outreach instead.'),
      { status: 200 }
    );
  }

  if (!completionResponse.ok) {
    const errorBody = await completionResponse.json().catch(() => undefined);
    const message =
      (errorBody && typeof errorBody.error === 'object' && errorBody.error && 'message' in errorBody.error
        ? (errorBody.error as { message?: string }).message
        : undefined) ?? completionResponse.statusText;
    console.error('OpenAI follow-up generation failed', message);
    return NextResponse.json(
      buildFallbackTasks(referral, daysInStatus, message || 'OpenAI returned an error while generating tasks.'),
      { status: 200 }
    );
  }

  const completion = await completionResponse.json().catch((error: unknown) => {
    console.error('Failed to parse OpenAI follow-up response', error);
    return null;
  });

  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    console.error('OpenAI follow-up content missing or invalid');
    return NextResponse.json(
      buildFallbackTasks(referral, daysInStatus, 'OpenAI returned an unexpected response format.'),
      { status: 200 }
    );
  }

  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.error('Failed to parse OpenAI follow-up JSON', error);
    return NextResponse.json(
      buildFallbackTasks(referral, daysInStatus, 'OpenAI returned invalid JSON for the follow-up plan.'),
      { status: 200 }
    );
  }

  const generatedAtRaw = (parsed as { generatedAt?: unknown }).generatedAt;
  const generatedAt = typeof generatedAtRaw === 'string' && generatedAtRaw ? generatedAtRaw : new Date().toISOString();

  const rawTasks = Array.isArray((parsed as { tasks?: unknown }).tasks) ? ((parsed as { tasks: unknown[] }).tasks ?? []) : [];

  const tasks = rawTasks
    .map((task) => {
      if (!task || typeof task !== 'object') {
        return null;
      }
      const audience = (task as { audience?: unknown }).audience;
      const title = (task as { title?: unknown }).title;
      const summary = (task as { summary?: unknown }).summary;
      const suggestedChannel = (task as { suggestedChannel?: unknown }).suggestedChannel;
      const urgency = (task as { urgency?: unknown }).urgency;

      const normalizedAudience =
        audience === 'Agent' || audience === 'MC' || audience === 'Referral' ? audience : 'Referral';

      return {
        audience: normalizedAudience,
        title: typeof title === 'string' ? title : 'Follow up',
        summary: typeof summary === 'string' ? summary : 'Reach out to gather additional context.',
        suggestedChannel:
          suggestedChannel === 'Phone' || suggestedChannel === 'Email' || suggestedChannel === 'Text' || suggestedChannel === 'Internal'
            ? suggestedChannel
            : 'Email',
        urgency: urgency === 'Low' || urgency === 'Medium' || urgency === 'High' ? urgency : 'Medium',
      };
    })
    .filter((task): task is NormalizedTask => task !== null);

  if (tasks.length === 0) {
    return NextResponse.json(
      buildFallbackTasks(referral, daysInStatus, 'AI response did not contain actionable follow-up items.'),
      { status: 200 }
    );
  }

  return NextResponse.json({ generatedAt, tasks, meta: { source: 'ai' as const } });
}
