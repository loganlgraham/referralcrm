import { fireEvent, render, screen } from '@testing-library/react';
import { ReferralAutomations } from '@/components/referrals/referral-automations';

const list = { personId: 123, isAdmin: true, canStart: true, enrollments: [
  { id: 5, automationId: 7, name: 'Welcome', status: 'Running' },
], choices: [{ id: 8, name: 'Day three follow-up', previousId: 0 }] };
const original = global.fetch;
afterEach(() => { global.fetch = original; });
const json = (data: unknown) => ({ ok: true, json: async () => data } as Response);
const renderCard = () => render(<ReferralAutomations personId={123} referralId="ref-test" borrowerName="Test Borrower" />);

it('shows a linked contact’s current run and lets an admin confirm a specific start once', async () => {
  const writes: string[] = [];
  global.fetch = jest.fn(async (_, options) => {
    if (options?.method === 'POST') {
      writes.push(String(options.body));
      return json({ personId: 123, enrollment: { id: 6, automationId: 8 } });
    }
    return json(list);
  });
  renderCard();
  expect(await screen.findByText('Welcome')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Start FUB automation' }));
  fireEvent.change(screen.getByLabelText('Automation'), { target: { value: '8' } });
  expect(screen.getByText(/Test Borrower/)).toBeVisible();
  expect(writes).toHaveLength(0);
  const button = screen.getByRole('button', { name: 'Confirm start' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(await screen.findByText('Started Day three follow-up.')).toBeVisible();
  expect(writes.map(body => JSON.parse(body))).toEqual([{ expectedPersonId: 123, automationId: 8, previousId: 0 }]);
});

it('hides the start action from a viewer and can list previously completed runs', async () => {
  global.fetch = jest.fn(async () => json({ ...list, isAdmin: false, canStart: false, choices: [],
    enrollments: [{ id: 4, automationId: 8, name: 'Previous sequence', status: 'Completed' }] }));
  renderCard();
  expect(await screen.findByText('No active automations for this contact.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Start FUB automation' })).toBeNull();
  fireEvent.click(screen.getByText('Completed (1)'));
  expect(screen.getByText('Previous sequence')).toBeVisible();
});

it('shows a read failure separately from an empty list and disables confirmation in preview', async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(new Error()).mockResolvedValue(json({ ...list, canStart: false }));
  renderCard();
  expect(await screen.findByText(/Couldn’t load/)).toBeVisible();
  fireEvent.click(screen.getByText('Refresh automations'));
  fireEvent.click(await screen.findByText('Start FUB automation'));
  fireEvent.change(screen.getByLabelText('Automation'), { target: { value: '8' } });
  expect(screen.getByText('Confirm start')).toBeDisabled();
});
