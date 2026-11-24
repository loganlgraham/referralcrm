import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { FubDashboard, FubDashboardView } from '@/components/dashboard/fub-dashboard';
import { fetcher } from '@/utils/fetcher';
import { fubDashboardFixture } from '../fixtures/fub-dashboard';
import { decisionRecord, fubSopFixture, sopReviews } from '../fixtures/fub-sop';

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

test('explains an unconfigured preview without fetching or displaying cached evidence', () => {
  jest.clearAllMocks();
  render(<FubDashboard userId="owner" configured={false} />);
  expect(screen.getByText('FUB data connection is not ready')).toBeInTheDocument();
  expect(screen.queryByText('Jordan Avery')).not.toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});

test('shows recorded reminder counts without turning the unknown first-call standard into a failure', () => {
  render(<FubDashboardView data={fubSopFixture} />);
  expect(screen.getAllByText('Not enough data')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '4 reminders' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '1 reminders' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '1 awaiting decision' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Day 3 reminders' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getAllByRole('link')).toHaveLength(4);
  expect(dialog.queryByRole('link', { name: 'Day 7 Jordan client' })).not.toBeInTheDocument();
  expect(dialog.getByRole('link', { name: 'Day 3 Jordan client' })).toHaveAttribute('href', 'https://americanhomeagents3.followupboss.com/2/people/view/1001');
  expect(dialog.getByText(/Missing reminders do not prove/)).toBeInTheDocument();
});

test('agent reminder evidence follows current owner and groups missing owners under unattributed activity', () => {
  render(<FubDashboardView data={fubSopFixture} />);
  fireEvent.click(screen.getByRole('button', { name: 'View Day 3 reminders for Jordan Avery' }));
  expect(within(screen.getByRole('dialog')).getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Day 3 Jordan client' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'View Day 3 reminders for Unattributed activity' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getAllByRole('link')).toHaveLength(2);
  expect(dialog.getByRole('link', { name: 'Day 3 unassigned client' })).toBeInTheDocument();
  expect(dialog.getByRole('link', { name: 'Day 3 unknown owner client' })).toBeInTheDocument();
});

test('Day 31 defaults to pending reviews and filters all, Keep and Release without dropping older source notes', () => {
  render(<FubDashboardView data={{ ...fubSopFixture, days: 7 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'View Day 31 reviews' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getAllByRole('link')).toHaveLength(1);
  expect(dialog.getByRole('link', { name: 'Pending review client' })).toBeInTheDocument();
  expect(dialog.getByText(/MT · marker observed/)).toBeInTheDocument();
  expect(dialog.getByText(/The Day 31 review marker was observed in FUB/)).toBeInTheDocument();
  expect(dialog.queryByText(/FUB note #/)).not.toBeInTheDocument();
  expect(dialog.queryByRole('link', { name: 'Keep review client' })).not.toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('Show Day 31 reviews'), { target: { value: 'all' } });
  expect(dialog.getAllByRole('link')).toHaveLength(3);
  fireEvent.change(dialog.getByLabelText('Show Day 31 reviews'), { target: { value: 'keep' } });
  expect(dialog.getAllByRole('link')).toHaveLength(1);
  expect(dialog.getByRole('link', { name: 'Keep review client' })).toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('Show Day 31 reviews'), { target: { value: 'release' } });
  expect(dialog.getAllByRole('link')).toHaveLength(1);
  expect(dialog.getByRole('link', { name: 'Release review client' })).toBeInTheDocument();
});

test('Day 31 agent filter is preserved when switching to all reviews', () => {
  render(<FubDashboardView data={fubSopFixture} />);
  fireEvent.click(screen.getByRole('button', { name: 'View Day 31 reviews for Jordan Avery' }));
  fireEvent.change(screen.getByLabelText('Show Day 31 reviews'), { target: { value: 'all' } });
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getAllByRole('link')).toHaveLength(2);
  expect(dialog.queryByRole('link', { name: 'Release review client' })).not.toBeInTheDocument();
});

test('unavailable reminder coverage does not display zero counts as measured', () => {
  const data = { ...fubSopFixture, sopAudits: [], sopMetrics: fubSopFixture.sopMetrics?.map((metric) => ({ ...metric, count: null })) };
  render(<FubDashboardView data={data} />);
  expect(screen.getAllByText('Not enough data')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'View Day 3 reminders for Jordan Avery' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'View Day 31 reviews for Jordan Avery' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '0 reminders' })).not.toBeInTheDocument();
});

test('missing optional SOP metrics also keep agent reminder counts unavailable', () => {
  render(<FubDashboardView data={{ ...fubSopFixture, sopMetrics: undefined }} />);
  expect(screen.getByRole('button', { name: 'View Day 3 reminders for Jordan Avery' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'View Day 7 reminders for Jordan Avery' })).toHaveTextContent('—');
});

test('a decision-read failure hides pending totals and disables decision recording', () => {
  const error = 'Day 31 decisions could not be loaded. Try again before recording a review.';
  render(<FubDashboardView data={{ ...fubSopFixture, day31Decisions: undefined, decisionError: error }} />);
  expect(screen.queryByRole('button', { name: /awaiting decision/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View Day 31 reviews for Jordan Avery' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'View Day 31 reviews' }));
  expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(error);
  expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument();
});

test('reviews use person plus tag episode identity when deciding whether a review is pending', () => {
  const duplicatePersonReview = { ...sopReviews[6], id: 'tag:44444444-4444-4444-8444-444444444444', customer: 'New review for kept client' };
  render(<FubDashboardView data={{ ...fubSopFixture, sopAudits: [...sopReviews, duplicatePersonReview] }} />);
  expect(screen.getByRole('button', { name: '2 awaiting decision' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Day 31 reviews' }));
  expect(screen.getByRole('link', { name: 'New review for kept client' })).toBeInTheDocument();
});

test('multiple observed episodes for one person stay distinct across the 25-row evidence pages', () => {
  const episodes = Array.from({ length: 42 }, (_, index) => ({
    ...sopReviews[5], id: `tag:66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`, customer: `Review episode ${index + 1}`,
  }));
  render(<FubDashboardView data={{
    ...fubSopFixture,
    sopAudits: [...sopReviews.filter((review) => review.kind !== 'day-31'), ...episodes],
    day31Decisions: [decisionRecord(episodes[0])],
    sopMetrics: fubSopFixture.sopMetrics?.map((metric) => metric.id === 'day-31' ? { ...metric, count: 42 } : metric),
  }} />);
  fireEvent.click(screen.getByRole('button', { name: '41 awaiting decision' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getAllByRole('link')).toHaveLength(25);
  expect(dialog.queryByRole('link', { name: 'Review episode 1' })).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Next' }));
  expect(dialog.getAllByRole('link')).toHaveLength(16);
  expect(dialog.getByRole('link', { name: 'Review episode 42' })).toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('Show Day 31 reviews'), { target: { value: 'keep' } });
  expect(dialog.getAllByRole('link')).toHaveLength(1);
  expect(dialog.getByRole('link', { name: 'Review episode 1' })).toBeInTheDocument();
});
