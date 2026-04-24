import { render, screen } from '@testing-library/react';
import { AgentOverviewCard } from '@/components/people/agent-overview-card';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() })
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('@/components/people/agent-admin-editor', () => ({
  AgentAdminEditor: () => null
}));

jest.mock('@/components/people/send-welcome-email-button', () => ({
  SendWelcomeEmailButton: () => null
}));

jest.mock('@/components/common/copy-button', () => ({
  CopyButton: () => null
}));

describe('AgentOverviewCard pills', () => {
  const baseAgent = {
    _id: 'agent-1',
    name: 'Agent One',
    email: 'agent1@example.com',
    active: true,
    signupStatus: {
      hasSignedUp: false,
      signedUpAfterWelcomeEmail: null,
      welcomeEmailSentAt: null
    }
  };

  it('shows logged-on fallback when there is no login timestamp', () => {
    render(<AgentOverviewCard agent={{ ...baseAgent, lastActivityAt: null, lastLoggedOnAt: null }} isAdmin />);

    expect(
      screen.getByText((_, element) => element?.textContent === 'Last activity: none yet')
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Logged on: none yet')
    ).toBeInTheDocument();
  });

  it('shows logged-on date when timestamp is available', () => {
    render(
      <AgentOverviewCard
        agent={{
          ...baseAgent,
          lastActivityAt: '2026-01-03T18:00:00.000Z',
          lastLoggedOnAt: '2026-01-04T18:00:00.000Z'
        }}
        isAdmin
      />
    );

    expect(
      screen.getByText((_, element) => element?.textContent === 'Last activity: Jan 3, 2026')
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Logged on: Jan 4, 2026')
    ).toBeInTheDocument();
  });
});
