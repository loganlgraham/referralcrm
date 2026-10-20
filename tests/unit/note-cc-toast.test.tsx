import { fireEvent, render, screen } from '@testing-library/react';

import { NoteCcForm } from '@/components/referrals/note-cc-toast';

describe('NoteCcForm', () => {
  it('adds and removes admin addresses from the CC list with one click', () => {
    const onConfirm = jest.fn();

    render(
      <NoteCcForm
        description="This note will email the agent."
        admins={[
          { name: 'Ada Admin', email: 'Ada@Example.com' },
          { name: 'Bea Admin', email: 'bea@example.com' },
        ]}
        initialEmails={[]}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ada Admin · ada@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bea Admin · bea@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add copies' }));

    expect(onConfirm).toHaveBeenCalledWith(['ada@example.com', 'bea@example.com']);
  });

  it('adds a typed address and rejects an invalid one', () => {
    const onConfirm = jest.fn();

    render(
      <NoteCcForm
        description="This note will email the agent."
        admins={[]}
        initialEmails={[]}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />
    );

    const field = screen.getByLabelText('CC email');
    fireEvent.change(field, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add copies' }));

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'extra@example.com' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Add copies' }));

    expect(onConfirm).toHaveBeenCalledWith(['extra@example.com']);
  });
});
