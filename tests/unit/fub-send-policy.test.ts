import {
  buildFubIntakeFields,
  buildFubIntakeSummary,
  mergeEmptyFubFields,
  resolveVerifiedAgentMapping,
} from '@/lib/fub/fub-send-policy';

describe('mock FUB send policy', () => {
  it('requires one audited mapping that is not claimed by another agent', () => {
    const ready = resolveVerifiedAgentMapping(
      [
        { agentId: 'agent-1', fubUserId: 71, auditedFubUserId: 71 },
        { agentId: 'agent-2', fubUserId: 72, auditedFubUserId: 72 },
      ],
      'agent-1',
    );
    expect(ready).toEqual({ state: 'ready', fubUserId: 71 });

    expect(resolveVerifiedAgentMapping([], 'agent-1')).toEqual({ state: 'missing' });
    expect(
      resolveVerifiedAgentMapping(
        [{ agentId: 'agent-1', fubUserId: 71, auditedFubUserId: null }],
        'agent-1',
      ),
    ).toEqual({ state: 'missing' });
    expect(
      resolveVerifiedAgentMapping(
        [
          { agentId: 'agent-1', fubUserId: 71, auditedFubUserId: 71 },
          { agentId: 'agent-2', fubUserId: 71, auditedFubUserId: 71 },
        ],
        'agent-1',
      ),
    ).toEqual({ state: 'ambiguous' });
    expect(
      resolveVerifiedAgentMapping(
        [{ agentId: 'agent-1', fubUserId: 71, auditedFubUserId: 70 }],
        'agent-1',
      ),
    ).toEqual({ state: 'missing' });
  });

  it('maps the allowlisted intake fields and fills only empty FUB fields', () => {
    const incoming = buildFubIntakeFields({
      source: 'KarimL',
      loanFileNumber: '12345678901',
      lookingInZip: '80014',
      lookingInZips: ['80014', '80231'],
      borrowerCurrentAddress: '1 Existing Way',
      loanType: 'Conventional',
      stageOnTransfer: 'Pre-approved',
    });

    expect(
      mergeEmptyFubFields(
        {
          referrioSource: 'Keep this source',
          referrioLoanFileNumber: '',
        },
        incoming,
      ),
    ).toMatchObject({
      referrioSource: 'Keep this source',
      referrioLoanFileNumber: '12345678901',
      referrioLookingInZip: '80014',
      referrioLookingInZips: '80014, 80231',
    });
  });

  it('builds one stable labeled intake-summary note', () => {
    const note = buildFubIntakeSummary({
      referralId: 'ref-1',
      customerName: 'Taylor Client',
      selectedAgentName: 'Manual Agent',
      selectionSource: 'manual',
      fields: { referrioLookingInZip: '80014' },
    });

    expect(note.key).toBe('referrio-aha-intake:ref-1');
    expect(note.label).toBe('Referrio AHA intake summary');
    expect(note.body).toContain('Manual Agent (manual override)');
  });
});
