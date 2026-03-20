import { fireEvent, render, screen } from '@testing-library/react';
import { ReferralTable } from '@/components/tables/referral-table';

const mockReplace = jest.fn();
const mockToastCustom = jest.fn();
const mockToastError = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/referrals',
  useSearchParams: () => ({
    toString: () => '',
    get: () => null,
  }),
}));

jest.mock('sonner', () => ({
  toast: {
    custom: (...args: unknown[]) => mockToastCustom(...args),
    success: jest.fn(),
    error: (...args: unknown[]) => mockToastError(...args),
    info: jest.fn(),
    dismiss: jest.fn(),
  },
}));

describe('ReferralTable agent status actions', () => {
  it('opens Under Contract toast card from agent table status select', () => {
    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-1',
            createdAt: new Date().toISOString(),
            borrowerName: 'Test Borrower',
            borrowerEmail: 'borrower@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-1',
            status: 'Active Lead',
          },
        ]}
      />
    );

    const statusSelect = screen.getByDisplayValue('Active Lead');
    fireEvent.change(statusSelect, { target: { value: 'Under Contract' } });

    expect(mockToastCustom).toHaveBeenCalled();
  });

  it('uses dropdown flow for terminated reason instead of prompt', () => {
    const promptSpy = jest.spyOn(window, 'prompt').mockImplementation(() => 'inspection');
    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-2',
            createdAt: new Date().toISOString(),
            borrowerName: 'Test Borrower 2',
            borrowerEmail: 'borrower2@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-2',
            status: 'Active Lead',
          },
        ]}
      />
    );

    const statusSelect = screen.getByDisplayValue('Active Lead');
    fireEvent.change(statusSelect, { target: { value: 'Terminated' } });

    expect(screen.getByText('Termination reason')).toBeInTheDocument();
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });
});
