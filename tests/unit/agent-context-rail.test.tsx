import { render, screen } from '@testing-library/react';

import { AgentContextRail } from '@/components/referrals/agent-referral-detail';

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn()
  }
}));

const baseProps = {
  agentSideLabel: 'Buy-side agent',
  clientType: 'Buyer',
  createdAt: '2026-01-01T00:00:00.000Z'
};

describe('AgentContextRail contact', () => {
  it('shows agent phone and copy controls for MC, agent, and client', () => {
    render(
      <AgentContextRail
        {...baseProps}
        mc={{ name: 'Logan MC', email: 'mc@example.com', phone: '2302349342' }}
        agent={{ name: 'Logan AHA', email: 'agent@example.com', phone: '5551234567' }}
        borrowerEmail="client@example.com"
        borrowerPhone="5559876543"
      />
    );

    expect(screen.getByText('230-234-9342')).toBeInTheDocument();
    expect(screen.getByText('555-123-4567')).toBeInTheDocument();
    expect(screen.getByText('555-987-6543')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Copy email')).toHaveLength(3);
    expect(screen.getAllByLabelText('Copy phone')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:mc@example.com');
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:2302349342');
  });

  it('hides missing agent phone and does not add Email or Call on the agent block', () => {
    render(
      <AgentContextRail {...baseProps} agent={{ name: 'Logan AHA', email: 'agent@example.com' }} />
    );

    expect(screen.getByText('agent@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Copy phone')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Email' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Call' })).not.toBeInTheDocument();
  });
});
