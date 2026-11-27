import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

import { AgentsTable } from '@/components/tables/agents-table';
import { DealsTable } from '@/components/tables/deals-table';
import { LendersTable } from '@/components/tables/lenders-table';

const mockFetch = jest.fn();
const mockReplace = jest.fn();

jest.mock('@/utils/fetcher', () => ({
  fetcher: (url: string) => mockFetch(url),
}));

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' } }, status: 'authenticated' }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function responseFor(name: string) {
  return {
    items: [{
      _id: name,
      name,
      email: 'partner@example.com',
      phone: '303-555-0100',
      nmlsId: '12345',
      statesLicensed: ['CO'],
      licensedStates: ['CO'],
      active: true,
      metrics: {
        closingsLast12Months: 1,
        closingRate: 50,
        avgResponseHours: 2,
        npsScore: 10,
        totalReferralFeesPaidCents: 100,
        totalNetIncomeCents: 100,
      },
      referralId: 'referral-1',
      status: 'under_contract',
      expectedAmountCents: 100,
      receivedAmountCents: 0,
      referral: { borrowerName: name },
    }],
    total: 1,
    page: 1,
    pageSize: 50,
  };
}

const tables = [
  { path: '/agents', Component: AgentsTable, placeholder: 'Name, email, phone, brokerage' },
  { path: '/deals', Component: DealsTable, placeholder: 'Borrower, address, loan #, agent' },
  { path: '/lenders', Component: LendersTable, placeholder: 'Name, email, phone, NMLS ID' },
];

describe('Directory search while results are loading', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
    mockReplace.mockReset();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(tables)('$path keeps typing and existing rows usable until the latest results arrive', async ({ path, Component, placeholder }) => {
    window.history.replaceState(null, '', `${path}?page=3&pageSize=50`);
    const requests = new Map<string, (response: ReturnType<typeof responseFor>) => void>();
    const failures = new Map<string, (error: Error) => void>();
    mockFetch.mockImplementation((url: string) => {
      const search = new URL(url, window.location.origin).searchParams.get('search');
      if (!search) {
        return Promise.resolve({ ...responseFor('Original record'), page: 3, total: 200 });
      }
      return new Promise((resolve, reject) => {
        requests.set(search, resolve);
        failures.set(search, reject);
      });
    });

    const config = {
      provider: () => new Map(),
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    };
    const table = () => <SWRConfig value={config}><Component /></SWRConfig>;
    const view = render(table());
    await act(async () => {});

    // Emulate Next's history integration notifying useSearchParams subscribers.
    const replaceState = window.history.replaceState.bind(window.history);
    jest.spyOn(window.history, 'replaceState').mockImplementation((state, title, url) => {
      replaceState(state, title, url);
      view.rerender(table());
    });

    const input = screen.getByPlaceholderText(placeholder);
    input.focus();
    const initialRequestCount = mockFetch.mock.calls.length;
    expect(screen.getByRole('link', { name: 'Original record' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Per page:' })).toBeEnabled();

    fireEvent.change(input, { target: { value: 'Ann' } });
    act(() => jest.advanceTimersByTime(150));
    fireEvent.change(input, { target: { value: 'Anna' } });
    act(() => jest.advanceTimersByTime(299));
    expect(mockFetch).toHaveBeenCalledTimes(initialRequestCount);
    expect(input).toHaveFocus();

    await act(async () => { jest.advanceTimersByTime(1); });
    expect(requests.has('Anna')).toBe(true);
    expect(new URLSearchParams(window.location.search).get('page')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('pageSize')).toBe('50');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(placeholder)).toBe(input);
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Original record' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Per page:' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(mockReplace).not.toHaveBeenCalled();

    // Keep typing during a slow response, then return the requests out of order.
    fireEvent.change(input, { target: { value: 'Anne' } });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(requests.has('Anne')).toBe(true);
    expect(input).toHaveValue('Anne');
    expect(input).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Original record' })).toBeVisible();

    await act(async () => { requests.get('Anne')!(responseFor('Latest match')); });
    expect(screen.getByRole('link', { name: 'Latest match' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Original record' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Per page:' })).toBeEnabled();

    await act(async () => { requests.get('Anna')!(responseFor('Older match')); });
    expect(screen.getByRole('link', { name: 'Latest match' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Older match' })).toBeNull();
    expect(screen.getByPlaceholderText(placeholder)).toBe(input);
    expect(input).toHaveValue('Anne');
    expect(input).toHaveFocus();

    // A failed refresh should explain the retained results without trapping typing.
    fireEvent.change(input, { target: { value: 'Unavailable' } });
    await act(async () => { jest.advanceTimersByTime(300); });
    await act(async () => { failures.get('Unavailable')!(new Error('Search unavailable')); });
    expect(screen.getByText(/couldn.t update results\. showing previous results\./i)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Latest match' })).toBeVisible();
    expect(screen.getByPlaceholderText(placeholder)).toBe(input);
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Per page:' })).toBeDisabled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    await act(async () => { requests.get('Unavailable')!(responseFor('Recovered match')); });
    expect(screen.getByRole('link', { name: 'Recovered match' })).toBeVisible();
    expect(screen.queryByText(/couldn.t update results/i)).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Per page:' })).toBeEnabled();
    expect(input).toHaveValue('Unavailable');
    fireEvent.change(input, { target: { value: 'Retry search' } });
    expect(input).toHaveValue('Retry search');
  });
});
