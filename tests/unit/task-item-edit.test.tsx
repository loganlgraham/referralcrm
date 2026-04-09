import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { TaskItem, type TaskItemData } from '@/components/admin/task-item';

function TaskItemHarness({
  task,
  onEdit,
}: {
  task: TaskItemData;
  onEdit: (taskId: string, updates: { title?: string; dueAt?: string | null }) => void | Promise<void>;
}) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(task._id);

  return (
    <ul>
      <TaskItem
        task={task}
        onComplete={jest.fn()}
        onDismiss={jest.fn()}
        onSnooze={jest.fn()}
        onUnsnooze={jest.fn()}
        onSetDueOverride={jest.fn()}
        onEdit={onEdit}
        expandedTaskId={expandedTaskId}
        onToggleExpand={(id) => setExpandedTaskId((prev) => (prev === id ? null : id))}
      />
    </ul>
  );
}

describe('TaskItem edit', () => {
  it('submits edit updates with title and dueAt', async () => {
    const onEdit = jest.fn(async () => undefined);
    const task: TaskItemData = {
      _id: 'task-1',
      referralId: 'ref-1',
      title: 'Assign Agent',
      status: 'open',
      dueAt: '2026-04-10T15:00:00.000Z',
      effectiveDueAt: '2026-04-10T15:00:00.000Z',
      ruleKey: 'assign_agent',
    };

    const { container } = render(<TaskItemHarness task={task} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit task' }));

    const titleInput = screen.getByPlaceholderText('Task name');
    fireEvent.change(titleInput, { target: { value: 'Assign Agent ASAP' } });

    const dueInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(dueInput).toBeTruthy();
    fireEvent.change(dueInput, { target: { value: '2026-04-12T10:30' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledWith('task-1', {
        title: 'Assign Agent ASAP',
        dueAt: new Date('2026-04-12T10:30').toISOString(),
      });
    });
  });
});
