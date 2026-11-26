import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntelligencePanel } from '@/components/referrals/intelligence-panel';

const unlinked = { officialScoring: false, access: 'allowed', link: null, activity: { status: 'not_requested' } };

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: async () => body,
  } as Response);
}

describe('intelligence panel', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps the entered id when the save fails', async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return jsonResponse({ officialScoring: false, access: 'allowed', saved: false, link: null, activity: { status: 'not_requested' } }, 400);
      return jsonResponse(unlinked);
    }) as typeof fetch;

    render(<IntelligencePanel referralId="ref-1" />);
    const input = await screen.findByLabelText('Follow Up Boss person id');
    fireEvent.change(input, { target: { value: '38620' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    expect(await screen.findByText("Couldn't save link.")).toBeInTheDocument();
    expect(screen.getByLabelText('Follow Up Boss person id')).toHaveValue('38620');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the linked id when the activity read fails and retries the read only', async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      calls.push({ method, url: href, body: typeof init?.body === 'string' ? init.body : undefined });
      if (method === 'PUT') {
        return jsonResponse({ officialScoring: false, access: 'allowed', saved: true, link: { personId: 38620, participantKey: 'borrower' }, activity: { status: 'not_requested' } });
      }
      if (calls.filter((call) => call.method === 'GET').length === 1) return jsonResponse(unlinked);
      return jsonResponse({
        officialScoring: false,
        access: 'allowed',
        link: { personId: 38620, participantKey: 'borrower' },
        activity: { status: 'unavailable' },
      });
    }) as typeof fetch;

    render(<IntelligencePanel referralId="ref-1" />);
    fireEvent.change(await screen.findByLabelText('Follow Up Boss person id'), { target: { value: '38620' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    expect(await screen.findByText('Linked to FUB contact 38620')).toBeInTheDocument();
    expect(screen.getByText("Activity couldn't load.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.filter((call) => call.url.includes('retry=1'))).toHaveLength(1));
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(screen.getByText('Linked to FUB contact 38620')).toBeInTheDocument();
  });

  it('shows access denied without a link form', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ officialScoring: false, access: 'denied', link: null, activity: { status: 'not_requested' } }, 403)) as typeof fetch;
    render(<IntelligencePanel referralId="ref-1" />);
    expect(await screen.findByText("You don't have access to this activity.")).toBeInTheDocument();
    expect(screen.queryByText('FUB stage')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Follow Up Boss person id')).not.toBeInTheDocument();
    expect(screen.queryByText('This is not no activity.')).not.toBeInTheDocument();
  });

  it('keeps a saved link visible when Follow Up Boss is not configured', async () => {
    global.fetch = jest.fn(async () => jsonResponse({
      officialScoring: false,
      access: 'allowed',
      link: { personId: 38620, participantKey: 'borrower' },
      activity: { status: 'not_configured' },
    })) as typeof fetch;

    render(<IntelligencePanel referralId="ref-1" />);
    expect(await screen.findByText('Linked to FUB contact 38620')).toBeInTheDocument();
    expect(screen.getByText("This customer is linked. The FUB activity connection is unavailable here.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry activity' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/referrals/ref-1/intelligence?retry=1', { cache: 'no-store' }));
    expect(screen.queryByText("This customer isn't linked.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Follow Up Boss person id')).not.toBeInTheDocument();
  });

  it.each([['Nurture', 'Nurture'], [null, 'Unavailable']])('shows the contact stage with no communication history (%s)', async (personStage, expected) => {
    global.fetch = jest.fn(async () => jsonResponse({
      access: 'allowed', link: { personId: 100, participantKey: 'borrower' },
      activity: { status: 'no_activity', personStage, coverageDetail: null },
    })) as typeof fetch;
    render(<IntelligencePanel referralId="ref-1" />);
    expect(await screen.findByText('FUB stage')).toBeVisible();
    expect(screen.getByText(expected!)).toBeVisible();
    expect(screen.getByText('No activity is stored for this contact.')).toBeVisible();
  });

  it('removes a link without creating another mapping', async () => {
    const bodies: unknown[] = [];
    global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        bodies.push(JSON.parse(String(init.body)));
        return jsonResponse({ officialScoring: false, access: 'allowed', saved: true, link: null, activity: { status: 'not_requested' } });
      }
      return jsonResponse({
        officialScoring: false,
        access: 'allowed',
        link: { personId: 38620, participantKey: 'borrower' },
        activity: { status: 'no_activity' },
      });
    }) as typeof fetch;

    render(<IntelligencePanel referralId="ref-1" />);
    expect(await screen.findByText('No activity is stored for this contact.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText("This customer isn't linked.")).toBeInTheDocument();
    expect(bodies).toEqual([{ participantKey: 'borrower', personId: null }]);
    expect(screen.queryByText('Linked to FUB contact 38620')).not.toBeInTheDocument();
  });

  it('keeps stored activity visible and puts an access failure in coverage details', async () => {
    global.fetch = jest.fn(async () => jsonResponse({
      officialScoring: false,
      access: 'allowed',
      link: { personId: 38620, participantKey: 'borrower' },
      activity: {
        status: 'ready',
        personStage: 'Actively shopping',
        incomplete: false,
        latest: { channel: 'text', direction: 'outbound', occurredAt: '2026-11-18T21:46:51.000Z', displayTime: '11/18/2026 2:46 PM' },
        followUp: { status: 'no_inbound', nextAction: 'No inbound call or text is stored.', detail: 'No inbound call or text is stored.' },
        fubAssignedUser: { id: 10, name: 'Andrew Landauer' },
        projectedClosings: [],
        referrioAgent: 'Weston Martin',
        agentsDiffer: true,
        freshnessNote: "Call coverage couldn't load.",
        coverageDetail: "Call coverage couldn't load. Stored activity is unchanged. This customer's API-visible text read is complete.",
      },
    })) as typeof fetch;

    render(<IntelligencePanel referralId="ref-1" />);
    expect(await screen.findByText('Linked to FUB contact 38620')).toBeInTheDocument();
    expect(screen.getByText(/Text outbound, 11\/18\/2026 2:46 PM/)).toBeInTheDocument();
    expect(screen.getByText('Actively shopping')).toBeVisible();
    expect(screen.getByText(/Andrew Landauer \(10\)/)).toBeInTheDocument();
    expect(screen.getByText("Call coverage couldn't load.")).toBeInTheDocument();
    expect(screen.queryByText('Some stored activity may be missing.')).not.toBeInTheDocument();
    expect(screen.queryByText('Call collection is not finished. An API-visible collection is not every real-world call.')).not.toBeInTheDocument();
    expect(screen.getByText(/This customer's API-visible text read is complete/)).toBeInTheDocument();
    expect(screen.getByText('Coverage').closest('details')?.hasAttribute('open')).toBe(false);
  });

  it('shows an unfinished collection separately from an access failure', async () => {
    global.fetch = jest.fn(async () => jsonResponse({
      officialScoring: false,
      access: 'allowed',
      link: { personId: 38620, participantKey: 'borrower' },
      activity: {
        status: 'ready',
        incomplete: true,
        latest: { channel: 'text', direction: 'outbound', occurredAt: '2026-11-18T21:46:51.000Z', displayTime: '11/18/2026 2:46 PM' },
        followUp: { status: 'no_inbound', nextAction: 'No inbound call or text is stored.', detail: 'No inbound call or text is stored.' },
        fubAssignedUser: { id: 10, name: 'Andrew Landauer' },
        projectedClosings: [],
        referrioAgent: null,
        agentsDiffer: false,
        freshnessNote: 'Some stored activity may be missing.',
        coverageDetail: 'Call collection is not finished. An API-visible collection is not every real-world call.',
      },
    })) as typeof fetch;

    render(<IntelligencePanel referralId="ref-1" />);
    expect(await screen.findByText('Some stored activity may be missing.')).toBeInTheDocument();
    expect(screen.queryByText("Call coverage couldn't load.")).not.toBeInTheDocument();
    expect(screen.getByText(/Call collection is not finished/)).toBeInTheDocument();
  });
});
