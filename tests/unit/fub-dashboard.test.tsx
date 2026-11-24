import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { FubDashboard, FubDashboardView } from '@/components/dashboard/fub-dashboard';
import { fetcher } from '@/utils/fetcher';
import { fubDashboardFixture } from '../fixtures/fub-dashboard';

jest.mock('@/utils/fetcher', () => ({ fetcher: jest.fn() }));

test('does not reuse another administrator’s cached evidence after an account switch', async () => {
  const cache = new Map();
  (fetcher as jest.Mock).mockResolvedValueOnce(fubDashboardFixture)
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = (userId: string) => (
    <SWRConfig value={{ provider: () => cache }}><FubDashboard userId={userId} /></SWRConfig>
  );
  const { rerender } = render(view('first-admin'));
  expect(await screen.findByText('Jordan Avery')).toBeInTheDocument();
  rerender(view('second-admin'));
  expect(screen.queryByText('Jordan Avery')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading FUB evidence');
});

test('keeps unknown SOPs distinct from measured counts and opens paginated call evidence', () => {
  render(<FubDashboardView data={fubDashboardFixture} />);
  expect(screen.getAllByText('Not enough data')).toHaveLength(4);
  expect(screen.getByText('1 documented')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View recorded calls for Jordan Avery' }));
  expect(screen.getByRole('link', { name: 'Example client 1' })).toHaveAttribute('href', 'https://americanhomeagents3.followupboss.com/2/people/view/100');
  expect(screen.queryByRole('link', { name: 'Example client 27' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('link', { name: 'Example client 27' })).toBeInTheDocument();
});
test('task drilldown shows the dated evidence and its limits', () => {
  render(<FubDashboardView data={fubDashboardFixture} />);
  fireEvent.click(screen.getByRole('button', { name: 'View overdue tasks for Jordan Avery' }));
  expect(screen.getByText('Follow Up is open and past its due date.')).toBeInTheDocument();
  expect(screen.getByText(/Missing task details are not counted as overdue/)).toBeInTheDocument();
  expect(screen.getByText(/date only/)).toBeInTheDocument();
});
