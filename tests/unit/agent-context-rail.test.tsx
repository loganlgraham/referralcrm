import { render, screen } from '@testing-library/react';

import { AgentContextRail } from '@/components/referrals/agent-referral-detail';

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn()
  }
}));

const baseProps = {
  otherAgentLabel: 'Sell-side agent',
  clientType: 'Buyer',
  createdAt: '2026-01-01T00:00:00.000Z'
};

describe('AgentContextRail contact', () => {
  it('shows phone and copy controls for the MC, the other-side agent, and the client', () => {
    render(
      <AgentContextRail
        {...baseProps}
        mc={{ name: 'Logan MC', email: 'mc@example.com', phone: '2302349342' }}
        otherAgent={{ name: 'Logan AHA', email: 'agent@example.com', phone: '5551234567' }}
        borrowerEmail="client@example.com"
        borrowerPhone="5559876543"
      />
    );

    expect(screen.getByText('230-234-9342')).toBeInTheDocument();
    expect(screen.getByText('555-123-4567')).toBeInTheDocument();
    expect(screen.getByText('555-987-6543')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Copy email')).toHaveLength(3);
    expect(screen.getAllByLabelText('Copy phone')).toHaveLength(3);
    const emailLinks = screen.getAllByRole('link', { name: 'Email' });
    expect(emailLinks.map((link) => link.getAttribute('href'))).toEqual([
      'mailto:mc@example.com',
      'mailto:agent@example.com'
    ]);
    const callLinks = screen.getAllByRole('link', { name: 'Call' });
    expect(callLinks.map((link) => link.getAttribute('href'))).toEqual(['tel:2302349342', 'tel:5551234567']);
  });

  it('hides the phone and Call action when the other-side agent has no phone', () => {
    render(
      <AgentContextRail {...baseProps} otherAgent={{ name: 'Logan AHA', email: 'agent@example.com' }} />
    );

    expect(screen.getByText('Sell-side agent')).toBeInTheDocument();
    expect(screen.getByText('agent@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Copy phone')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:agent@example.com');
    expect(screen.queryByRole('link', { name: 'Call' })).not.toBeInTheDocument();
  });
});
