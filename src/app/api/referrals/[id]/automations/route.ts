import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MockFubOperationError } from '@/lib/fub/mock-fub-orchestrator';
import { logReferralActivity } from '@/lib/server/activities';
import { readCustomerLink } from '@/lib/server/intelligence-links';
import { liveFubEnabled, readFubAutomations, startFubAutomation } from '@/lib/server/live-fub-handoff';
import { allowedMutation, loadAuthorized } from '@/lib/server/referral-fub-context';
import { FubAutomationStart } from '@/models/fub-automation-start';

export const dynamic = 'force-dynamic';
type Context = { params: { id: string } };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const startInput = z.object({
  expectedPersonId: z.number().int().positive(),
  automationId: z.number().int().positive(),
  previousId: z.number().int().nonnegative(),
}).strict();

async function contextFor(req: NextRequest, id: string, starting: boolean) {
  if (!allowedMutation(req)) return { error: reply({ error: 'Access denied.' }, 403) };
  const viewer = await loadAuthorized(id);
  if (!viewer.ok) return { error: reply({ error: 'Referral access unavailable.' }, viewer.status) };
  if (starting && !viewer.isAdmin) return { error: reply({ error: 'An administrator must start the automation.' }, 403) };
  if (!viewer.configured) return { error: reply({ error: 'FUB automations are unavailable.' }, 503) };
  if (starting && !liveFubEnabled()) return { error: reply({ error: 'Live starts are available in production only.' }, 503) };
  const link = await readCustomerLink({ organization: viewer.organization, fubAccountId: viewer.accountId, referralId: id, participantKey: 'borrower' });
  if (!link?.fubPersonId) return { error: reply({ error: 'Link a Follow Up Boss contact first.' }, 409) };
  return { viewer, personId: link.fubPersonId };
}

export async function GET(request: NextRequest, { params }: Context) {
  const context = await contextFor(request, params.id, false);
  if (context.error) return context.error;
  const { personId, viewer } = context;
  try {
    const list = await readFubAutomations(personId, viewer.isAdmin);
    if (list.personId !== personId || !Array.isArray(list.enrollments) || !Array.isArray(list.choices)) throw new Error();
    return reply({ ...list, choices: viewer.isAdmin ? list.choices : [], isAdmin: viewer.isAdmin, canStart: viewer.isAdmin && liveFubEnabled() });
  } catch (error) {
    if (error instanceof MockFubOperationError && error.code === 'fub_automations_restricted' && error.status === 403) {
      return reply({
        code: 'fub_automations_restricted',
        error: 'Follow Up Boss hasn’t enabled automation access for this connection. Contact Follow Up Boss to enable access for the registered integration.',
      }, 503);
    }
    return reply({ error: 'Could not load FUB automations.' }, 503);
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const context = await contextFor(request, params.id, true);
  if (context.error) return context.error;
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Invalid start request.' }, 400);
  const input = startInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: 'Choose an automation.' }, 400);
  const { personId, viewer } = context;
  if (personId !== input.data.expectedPersonId) return reply({ error: 'The linked customer changed. Refresh the referral.' }, 409);
  const { automationId, previousId } = input.data;
  const key = [viewer.accountId, personId, automationId, previousId].join(':');
  try {
    await FubAutomationStart.create({ _id: key, referralId: params.id, actorId: viewer.userId });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return reply({ error: 'A start was already requested. Check the customer in Follow Up Boss.' }, 409);
    throw error;
  }
  let result;
  try {
    result = await startFubAutomation(personId, automationId, previousId);
    if (result.personId !== personId || result.enrollment?.automationId !== automationId || !result.enrollment.id) throw new Error();
  } catch (error) {
    if (error instanceof MockFubOperationError && error.certainty === 'definitive') {
      await FubAutomationStart.deleteOne({ _id: key });
      return reply({ error: error.message }, error.status);
    }
    return reply({ error: 'FUB did not confirm the start. Check the customer in Follow Up Boss before trying again.' }, 502);
  }
  const audit = await Promise.allSettled([
    FubAutomationStart.updateOne({ _id: key }, { $set: { enrollmentId: result.enrollment.id } }),
    logReferralActivity({ referralId: params.id, actorRole: 'admin', actorId: viewer.userId, channel: 'update', content: 'Started FUB automation “' + result.enrollment.name + '”.' }),
  ]);
  const auditIncomplete = audit.some(entry => entry.status === 'rejected');
  if (auditIncomplete) console.error('FUB automation start confirmed with incomplete local audit', { referralId: params.id, enrollmentId: result.enrollment.id });
  return reply({ ...result, auditIncomplete }, 201);
}
