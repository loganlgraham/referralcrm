import { render, screen } from '@testing-library/react';

import { ReferralNotes } from '@/components/referrals/referral-notes';
import { ReferralTimeline } from '@/components/referrals/referral-timeline';

const mockMutate = jest.fn();
const mockUseSWR = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

type SwrResponse = {
  data?: unknown;
  error?: unknown;
  isLoading?: boolean;
};

const swrResponses = new Map<string, SwrResponse>();

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string) =>
    mockUseSWR(key) ??
    {
      data: undefined,
      error: undefined,
      isLoading: false,
    },
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

describe('ReferralNotes', () => {
  beforeEach(() => {
    swrResponses.clear();
    mockUseSWR.mockImplementation((key: string) => {
      const response = swrResponses.get(key);
      return {
        data: response?.data,
        error: response?.error,
        isLoading: response?.isLoading ?? false,
      };
    });
  });

  afterEach(() => {
    mockMutate.mockReset();
    mockUseSWR.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it('renders only stored notes and ignores stale activity-only note content', () => {
    swrResponses.set('/api/referrals/ref-1/activities', {
      data: [
        {
          _id: 'activity-1',
          actor: 'Admin',
          channel: 'note',
          content: 'Original stale activity note',
          createdAt: '2026-04-01T12:00:00.000Z',
        },
      ],
    });

    render(
      <ReferralNotes
        referralId="ref-1"
        viewerRole="admin"
        initialNotes={[
          {
            id: 'note-1',
            authorName: 'Taylor Admin',
            authorRole: 'admin',
            content: 'Updated stored note',
            createdAt: '2026-04-01T12:05:00.000Z',
          },
        ]}
      />
    );

    expect(screen.getByText('Updated stored note')).toBeInTheDocument();
    expect(screen.queryByText('Original stale activity note')).not.toBeInTheDocument();
    expect(mockUseSWR).not.toHaveBeenCalled();
  });

  it('shows edit for agents but reserves delete for admin-like roles', () => {
    const note = {
      id: 'note-2',
      authorName: 'Jordan Agent',
      authorRole: 'agent',
      content: 'Stored note content',
      createdAt: '2026-04-01T12:00:00.000Z',
    };

    const { rerender } = render(
      <ReferralNotes referralId="ref-2" viewerRole="agent" initialNotes={[note]} />
    );

    expect(screen.getByLabelText('Edit note')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete note')).not.toBeInTheDocument();

    rerender(<ReferralNotes referralId="ref-2" viewerRole="admin" initialNotes={[note]} />);

    expect(screen.getByLabelText('Edit note')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete note')).toBeInTheDocument();
  });

  it('defaults Email MC off for admin and on for agent when MC email exists', () => {
    const mcContact = { name: 'MC One', email: 'mc@example.com' };

    const { unmount } = render(
      <ReferralNotes
        referralId="ref-email-default-admin"
        viewerRole="admin"
        initialNotes={[]}
        mcContact={mcContact}
        hasAnyPayments={false}
        hasAnyUsedAfcTrue={false}
      />
    );

    expect(screen.getByRole('switch', { name: 'Email MC' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    unmount();

    render(
      <ReferralNotes
        referralId="ref-email-default-agent"
        viewerRole="agent"
        initialNotes={[]}
        mcContact={mcContact}
        hasAnyPayments={false}
        hasAnyUsedAfcTrue={false}
      />
    );

    expect(screen.getByRole('switch', { name: 'Email MC' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('shows no stored notes while the timeline still shows note audit entries', () => {
    swrResponses.set('/api/referrals/ref-3/activities', {
      data: [
        {
          _id: 'activity-2',
          actor: 'Admin',
          channel: 'note',
          content: 'Deleted note by Taylor Admin: Old content',
          createdAt: '2026-04-01T13:00:00.000Z',
        },
      ],
    });

    render(
      <>
        <ReferralNotes referralId="ref-3" viewerRole="admin" initialNotes={[]} />
        <ReferralTimeline referralId="ref-3" />
      </>
    );

    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
    expect(screen.getByText('Deleted note by Taylor Admin: Old content')).toBeInTheDocument();
  });
});
