/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';

import {
  PairedFubConfirmationCard,
  fubSendOutcomeMessage,
} from '@/components/referrals/paired-fub-confirmation-toast';

describe('Paired FUB confirmation', () => {
  it('shows the customer, selected manual override, and explicit send action', () => {
    const onChoose = jest.fn();
    render(
      <PairedFubConfirmationCard
        preview={{
          customerName: 'Taylor Client',
          selectedAgentName: 'Manual Agent',
          fubAssigneeName: 'Kristen Truong',
          selectionSource: 'manual',
          mappingState: 'ready',
          existingPersonId: 38620,
          approvalKey: 'approval-key',
          attemptStatus: null,
        }}
        onChoose={onChoose}
      />,
    );

    expect(screen.getByText('Taylor Client')).toBeVisible();
    expect(screen.getByText('Manual Agent')).toBeVisible();
    expect(screen.getByText('Kristen Truong')).toBeVisible();
    expect(screen.getByText('Manual override')).toBeVisible();
    expect(screen.getByText('Existing FUB customer 38620 will be preserved.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pair and send to FUB' }));
    expect(onChoose).toHaveBeenCalledWith('send');
  });

  it('blocks sending for a missing mapping but allows Paired only', () => {
    const onChoose = jest.fn();
    render(
      <PairedFubConfirmationCard
        preview={{
          customerName: 'Taylor Client',
          selectedAgentName: 'Unmapped Agent',
          selectionSource: 'auto',
          mappingState: 'missing',
          existingPersonId: null,
          approvalKey: 'approval-key',
          attemptStatus: null,
        }}
        onChoose={onChoose}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Pair and send to FUB' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move to Paired only' }));
    expect(onChoose).toHaveBeenCalledWith('paired_only');
  });

  it('never describes partial or ambiguous results as success', () => {
    expect(fubSendOutcomeMessage('partial_failure', false)).toMatchObject({
      kind: 'error',
    });
    expect(fubSendOutcomeMessage('ambiguous', false)).toMatchObject({
      kind: 'error',
    });
    expect(fubSendOutcomeMessage('success', true)).toMatchObject({
      kind: 'success',
      message: expect.stringContaining('recovered'),
    });
  });
});
