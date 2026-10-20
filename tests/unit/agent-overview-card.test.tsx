import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { AgentOverviewCard } from '@/components/people/agent-overview-card';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() })
}));

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    data: {
      score: 82.4,
      rank: 3,
      qualified: true,
      timeframeLabel: 'This Month'
    },
    isLoading: false
  }))
}));

jest.mock('sonner', () => {
  const toastFn = Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    custom: jest.fn(),
    dismiss: jest.fn()
  });
  return { toast: toastFn };
});

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
    expect(screen.getByText('82.4 / 100')).toBeInTheDocument();
    expect(screen.getByText('This Month · Rank #3')).toBeInTheDocument();
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

  it('lets an admin update NPS from the overview card', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <AgentOverviewCard
        agent={{ ...baseAgent, npsScore: 68, lastActivityAt: null, lastLoggedOnAt: null }}
        isAdmin
      />
    );

    expect(screen.getByText('68.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('spinbutton', { name: 'NPS Score' })).toHaveValue(68);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'NPS Score' }), {
      target: { value: '72' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npsScore: 72 }),
      })
    );
    expect(screen.getByText('72.0')).toBeInTheDocument();
  });

  it('excludes the agent from leaderboards when the inactive toast "Exclude" action is chosen', async () => {
    const toastMock = toast as unknown as {
      custom: jest.Mock;
      dismiss: jest.Mock;
    };
    toastMock.custom.mockClear();

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <AgentOverviewCard
        agent={{ ...baseAgent, active: true, lastActivityAt: null, lastLoggedOnAt: null }}
        isAdmin
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark inactive' }));

    expect(toastMock.custom).toHaveBeenCalledTimes(1);
    const renderToast = toastMock.custom.mock.calls[0][0] as (id: string) => JSX.Element;
    render(renderToast('toast-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Exclude from leaderboards' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(JSON.parse((requestInit as RequestInit).body as string)).toEqual({
      active: false,
      includeInMetrics: false
    });
  });
});
