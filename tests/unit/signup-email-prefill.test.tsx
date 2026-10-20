import { render, screen } from '@testing-library/react';

import SignupPage from '@/app/signup/page';

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'role' ? 'agent' : key === 'email' ? 'invitee@example.com' : null),
  }),
}));

jest.mock('next-auth/react', () => ({
  signIn: jest.fn(),
}));

describe('SignupPage invite link', () => {
  it('fills the email from the welcome link', async () => {
    render(<SignupPage />);

    expect(await screen.findByLabelText('Email')).toHaveValue('invitee@example.com');
  });
});
