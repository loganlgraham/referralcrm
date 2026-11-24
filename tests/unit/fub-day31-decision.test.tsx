import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FubDay31Decision } from '@/components/dashboard/fub-day31-decision';
import { FubDashboardView } from '@/components/dashboard/fub-dashboard';
import { decisionRecord, fubSopFixture, sopReviews } from '../fixtures/fub-sop';

const review = sopReviews[5];
const uuid = 'b8b2f424-ce1d-450f-8baa-a4348298ad13';
const nextUuid = 'edfb528d-cf70-4315-a416-7687eb66bfc5';
const originalFetch = global.fetch;
const originalUuid = Object.getOwnPropertyDescriptor(global.crypto, 'randomUUID');
const mockFetch = jest.fn();
const mockUuid = jest.fn();
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeAll(() => {
  global.fetch = mockFetch;
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: mockUuid });
});
beforeEach(() => {
  mockFetch.mockReset();
  mockUuid.mockReset().mockReturnValue(uuid);
});
afterAll(() => {
  global.fetch = originalFetch;
  if (originalUuid) Object.defineProperty(global.crypto, 'randomUUID', originalUuid);
  else Reflect.deleteProperty(global.crypto, 'randomUUID');
});

function fillDecision(reason = 'Client confirmed a January move.') {
  fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
  fireEvent.change(screen.getByLabelText('Day 31 decision'), { target: { value: 'keep' } });
  fireEvent.change(screen.getByLabelText('Reason for this decision'), { target: { value: reason } });
}

test('requires an explicit choice and nonblank reason before enabling Save', () => {
  render(<FubDay31Decision review={review} onSaved={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
  const save = screen.getByRole('button', { name: 'Save decision' });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason for this decision'), { target: { value: 'Reviewed the client.' } });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Day 31 decision'), { target: { value: 'keep' } });
  expect(save).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Reason for this decision'), { target: { value: '   ' } });
  expect(save).toBeDisabled();
  expect(screen.getByLabelText('Reason for this decision')).toHaveAttribute('maxlength', '2000');
  expect(mockFetch).not.toHaveBeenCalled();
});

test('sends the exact source and trimmed reason, keeps controls disabled during save, and shows confirmed success', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  mockFetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const onSaved = jest.fn();
  render(<FubDay31Decision review={review} onSaved={onSaved} />);
  fillDecision('  Client confirmed a January move.  ');
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByLabelText('Day 31 decision')).toBeDisabled();
  expect(screen.getByLabelText('Reason for this decision')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(mockFetch).toHaveBeenCalledWith('/api/dashboard/fub/decisions', expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
    personId: review.personId, noteId: review.sourceNoteId, decision: 'keep', reason: 'Client confirmed a January move.', expectedRevision: 0, requestId: uuid,
  });
  const record = decisionRecord(review);
  finish(response({ ok: true, changed: true, record }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(record));
  expect(screen.getByRole('status')).toHaveTextContent('Decision recorded.');
});

test('an unconfirmed save retries the same command with the same request ID', async () => {
  mockFetch.mockRejectedValueOnce(new Error('connection interrupted'))
    .mockResolvedValueOnce(response({ ok: true, changed: false, record: decisionRecord(review) }));
  const onSaved = jest.fn();
  render(<FubDay31Decision review={review} onSaved={onSaved} />);
  fillDecision();
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry with the same decision');
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(mockFetch.mock.calls[1][1].body).toEqual(mockFetch.mock.calls[0][1].body);
  expect(mockUuid).toHaveBeenCalledTimes(1);
});

test('changing an unconfirmed command creates a new request ID while retaining the original revision guard', async () => {
  mockUuid.mockReturnValueOnce(uuid).mockReturnValueOnce(nextUuid);
  mockFetch.mockRejectedValueOnce(new Error('connection interrupted')).mockResolvedValueOnce(response({ error: 'Refresh the review.' }, 409));
  render(<FubDay31Decision review={review} onSaved={jest.fn()} />);
  fillDecision();
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Reason for this decision'), { target: { value: 'Client requested another review.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({ requestId: nextUuid, expectedRevision: 0, reason: 'Client requested another review.' });
  expect(await screen.findByRole('alert')).toHaveTextContent('changed while you were editing');
});

test('changes start from the displayed revision and a conflict never overwrites the current decision', async () => {
  const record = decisionRecord(review);
  const onSaved = jest.fn();
  mockFetch.mockResolvedValue(response({ error: 'Conflict' }, 409));
  render(<FubDay31Decision review={review} record={record} onSaved={onSaved} />);
  expect(screen.getByText('Decision history (1)')).toBeInTheDocument();
  expect(screen.getByText(/Recorded by Stored Reviewer/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change decision' }));
  expect(screen.getByLabelText('Day 31 decision')).toHaveValue('keep');
  fireEvent.change(screen.getByLabelText('Day 31 decision'), { target: { value: 'release' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed while you were editing');
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ expectedRevision: 1, decision: 'release' });
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByText('Decision: Keep')).toBeInTheDocument();
});

test.each([null, { ...decisionRecord(review), personId: 999 }, { ...decisionRecord(review), noteId: 999 }])('does not accept a missing or unrelated save record %#', async (record) => {
  mockFetch.mockResolvedValue(response({ ok: true, record }));
  const onSaved = jest.fn();
  render(<FubDay31Decision review={review} onSaved={onSaved} />);
  fillDecision();
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('a confirmed save updates pending counts immediately and stays visible in All reviews during refresh', async () => {
  const record = decisionRecord(review);
  mockFetch.mockResolvedValue(response({ ok: true, changed: true, record }));
  const onDataChange = jest.fn();
  const { rerender } = render(<FubDashboardView data={fubSopFixture} onDataChange={onDataChange} />);
  fireEvent.click(screen.getByRole('button', { name: '1 awaiting decision' }));
  fillDecision();
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }));
  await waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: '0 awaiting decision' })).toBeInTheDocument();
  expect(screen.getByLabelText('Show Day 31 reviews')).toHaveValue('all');
  expect(screen.getByRole('link', { name: 'Pending review client' })).toBeInTheDocument();
  rerender(<FubDashboardView data={{ ...fubSopFixture }} onDataChange={onDataChange} />);
  expect(screen.getByRole('button', { name: '0 awaiting decision' })).toBeInTheDocument();
});
