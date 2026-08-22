import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AdminTasksCard } from '@/components/referrals/admin-tasks-card';

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

const HELPER_COPY = 'Select a day to view and manage tasks.';

describe('AdminTasksCard calendar', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it('shows a dot for days with tasks and filters the list on click', async () => {
    const now = new Date();
    const taskDay = Math.min(now.getDate() + 1, 27);
    const otherDay = Math.min(taskDay + 1, 28);
    const dueAt = new Date(now.getFullYear(), now.getMonth(), taskDay, 10, 30, 0).toISOString();
    const otherDueAt = new Date(now.getFullYear(), now.getMonth(), otherDay, 10, 30, 0).toISOString();
    const taskTitle = `Task for day-${taskDay}`;
    const otherTitle = `Task for day-${otherDay}`;

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url.includes('/api/admin/tasks?')) {
        return {
          ok: true,
          json: async () => [
            {
              _id: 'task-1',
              referralId: 'ref-1',
              title: taskTitle,
              status: 'open',
              dueAt,
              effectiveDueAt: dueAt,
              cycleKey: 'manual',
              createdAt: dueAt,
              createdBy: 'admin',
            },
            {
              _id: 'task-2',
              referralId: 'ref-1',
              title: otherTitle,
              status: 'open',
              dueAt: otherDueAt,
              effectiveDueAt: otherDueAt,
              cycleKey: 'manual',
              createdAt: otherDueAt,
              createdBy: 'admin',
            },
          ],
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    render(<AdminTasksCard referralId="ref-1" viewerRole="admin" />);

    expect(screen.queryByText(HELPER_COPY)).not.toBeInTheDocument();

    const dayButton = screen.getByRole('button', { name: String(taskDay) });
    await waitFor(() => {
      expect(dayButton.querySelector('span.rounded-full')).toBeTruthy();
    });

    fireEvent.click(dayButton);

    await waitFor(() => {
      expect(screen.getByText(taskTitle)).toBeInTheDocument();
    });

    expect(screen.queryByText(HELPER_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText(otherTitle)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear day filter' })).toBeInTheDocument();
  });

  it('allows creating a manual task from an empty calendar day', async () => {
    const now = new Date();
    const emptyDay = Math.min(now.getDate() + 2, 28);
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url.includes('/api/admin/tasks?')) {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }

      if (init?.method === 'POST' && url === '/api/admin/tasks') {
        return {
          ok: true,
          json: async () => ({ _id: 'new-task' }),
        } as Response;
      }

      return { ok: true, json: async () => ({}) } as Response;
    });
    global.fetch = fetchMock as typeof fetch;

    render(<AdminTasksCard referralId="ref-empty-day" viewerRole="admin" />);

    expect(screen.queryByText(HELPER_COPY)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: String(emptyDay) }));

    await waitFor(() => {
      expect(screen.getByText('No tasks due on this day.')).toBeInTheDocument();
    });

    expect(screen.queryByText(HELPER_COPY)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add task for this day/i }));
    fireEvent.change(screen.getByPlaceholderText('Task name'), { target: { value: 'Manual calendar task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) => String(call[0]) === '/api/admin/tasks' && call[1]?.method === 'POST'
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(String(postCall?.[1]?.body));
      expect(body.referralId).toBe('ref-empty-day');
      expect(body.title).toBe('Manual calendar task');
      const submittedDate = new Date(body.dueAt);
      expect(submittedDate.getDate()).toBe(emptyDay);
    });
  });
});
