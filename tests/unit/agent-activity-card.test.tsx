import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AgentActivityCard } from '@/components/people/agent-activity-card';

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    data: Array.from({ length: 5 }, (_, index) => ({
      id: `activity-${index}`,
      action: index === 0 ? 'login' : 'update',
      content: index === 0 ? 'Logged in to the CRM' : `Updated referral ${index}`,
      createdAt: `2026-08-0${index + 1}T14:00:00.000Z`,
      referral:
        index === 0
          ? null
          : {
              id: `referral-${index}`,
              borrowerName: `Client ${index}`,
              loanFileNumber: null,
            },
    })),
    error: null,
    isLoading: false,
  })),
}));

describe('AgentActivityCard', () => {
  it('shows five recent agent actions and downloads the all-time CSV', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['csv']),
      headers: new Headers({
        'content-disposition': 'attachment; filename="agent-example-activity-log.csv"',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const createObjectUrl = jest.fn(() => 'blob:activity-log');
    const revokeObjectUrl = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<AgentActivityCard agentId="agent-123" />);

    expect(screen.getByText('Logged in to the CRM')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Client 1' })).toHaveAttribute(
      'href',
      '/referrals/referral-1'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download full activity log (.csv)' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-123/activity?format=csv')
    );
    expect(createObjectUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:activity-log');
    clickSpy.mockRestore();
  });
});
