import { createHmac } from 'node:crypto';
import { getVercelOidcToken } from '@vercel/functions/oidc';

import type { AutomationList, FubEnrollment } from '@/lib/fub/automations';
import { VERIFIED_FUB_ACCOUNT_ID } from '@/lib/intelligence/access-control';
import { trustedIntelligenceUrl } from '@/lib/intelligence/remote';
import {
  MockFubOperationError,
  type MockFubClient,
} from '@/lib/fub/mock-fub-orchestrator';
import { InboundReferralMessage } from '@/models/inbound-referral-message';

export function liveFubEnabled() {
  return (
    process.env.VERCEL_ENV === 'production' &&
    process.env.REFERRIO_FUB_ACCOUNT_ID === VERIFIED_FUB_ACCOUNT_ID &&
    Boolean(
      process.env.REFERRIO_INTEGRATION_SECRET &&
        trustedIntelligenceUrl(process.env.REFERRIO_INTELLIGENCE_URL ?? ''),
    )
  );
}

async function perform<T>(operation: string, input: unknown): Promise<T> {
  const previewRead = operation === 'automation_list' && process.env.VERCEL_ENV === 'preview'
    && process.env.REFERRIO_FUB_ACCOUNT_ID === VERIFIED_FUB_ACCOUNT_ID;
  const origin = trustedIntelligenceUrl(
    process.env.REFERRIO_INTELLIGENCE_URL ?? '',
  );
  const secret = process.env.REFERRIO_INTEGRATION_SECRET;
  if ((!liveFubEnabled() && !previewRead) || !origin || !secret)
    throw new Error('Follow Up Boss is unavailable.');
  const body = JSON.stringify({
    operation,
    input,
    account: VERIFIED_FUB_ACCOUNT_ID,
    organization: 'AHA',
  });
  const time = String(Date.now());
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-referrio-time': time,
    'x-referrio-signature': createHmac('sha256', secret)
      .update('handoff-v1\n' + time + '\n' + body)
      .digest('hex'),
  };
  const oidc = await getVercelOidcToken().catch(() => null);
  if (oidc) headers['x-vercel-trusted-oidc-idp-token'] = oidc;
  const res = await fetch(
    new URL('/api/integration/referrio/handoff', origin),
    {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(45000),
    },
  );
  const result = await res.json().catch(() => null);
  if (!res.ok || !result) {
    const code = operation === 'automation_list' && res.status === 403
      && result?.code === 'fub_automations_restricted'
      ? 'fub_automations_restricted'
      : 'fub_handoff_incomplete';
    throw new MockFubOperationError(
      result?.uncertain === false ? 'definitive' : 'ambiguous',
      code,
      result?.error ?? 'Follow Up Boss did not confirm the operation.',
      res.ok ? 502 : res.status,
    );
  }
  return result as T;
}
export function readFubAutomations(personId: number, includeChoices: boolean) {
  return perform<AutomationList>('automation_list', { personId, includeChoices });
}

export function startFubAutomation(personId: number, automationId: number, previousId: number) {
  return perform<{ personId: number; enrollment: FubEnrollment }>('automation_start', { personId, automationId, previousId });
}

export async function getFubAgentChoices() {
  const result = await perform<{ users: Array<{ id: number; name: string }> }>(
    'agent_choices',
    {},
  );
  return result.users;
}

export function createLiveFubClient(fubUserId: number): MockFubClient {
  return {
    resolveCustomer: (input) =>
      perform('resolve_customer', { ...input, fubUserId }),
    assignAgent: (input) => perform('assign_agent', input),
    populateFields: (input) => perform('populate_fields', input),
    addNote: (input) => perform('add_note', input),
  };
}

type Original = {
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  receivedAt?: Date | string;
  text?: string;
  html?: string;
  attachmentNames?: string[];
  fields?: Array<{ label: string; value: string }>;
};

export async function readIntakeForHandoff(messageId: string) {
  let original =
    await InboundReferralMessage.findById(messageId).lean<Original>();
  if (!original) {
    // Records imported before original emails were archived carry their Resend receiving ID.
    const res = await fetch(
      'https://api.resend.com/emails/receiving/' +
        encodeURIComponent(messageId),
      {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok)
      throw new Error('The original intake email could not be retrieved.');
    const payload = await res.json();
    const email = payload.data ?? payload;
    if (email.id !== messageId)
      throw new Error('The original intake email could not be verified.');
    original = {
      from: email.from,
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      text: email.text,
      html: email.html,
      receivedAt: email.created_at,
      attachmentNames: email.attachments?.map(
        (a: { filename: string }) => a.filename,
      ),
    };
  }
  const body = original.text || original.html || '';
  const fields = Object.fromEntries(
    (original.fields ?? []).map(({ label, value }) => [label, value]),
  );
  if (!original.fields?.length) {
    for (const line of body.split(/\r?\n|<br\s*\/?>/i)) {
      const match = /^\s*([^:]{1,100}):\s*(.+)$/.exec(line);
      if (match) fields[match[1]] = match[2];
    }
  }
  const note =
    [
      original.from && 'From: ' + original.from,
      original.to?.length && 'To: ' + original.to.join(', '),
      original.cc?.length && 'Cc: ' + original.cc.join(', '),
      original.receivedAt &&
        'Date: ' + new Date(original.receivedAt).toISOString(),
      'Subject: ' + (original.subject ?? ''),
      original.attachmentNames?.length &&
        'Attachments: ' + original.attachmentNames.join(', '),
    ]
      .filter(Boolean)
      .join('\n') +
    '\n\n' +
    body;
  return { fields, note };
}
