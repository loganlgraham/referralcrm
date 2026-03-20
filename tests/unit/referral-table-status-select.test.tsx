import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReferralTable } from '@/components/tables/referral-table';
import { TERMINATED_REASON_OPTIONS } from '@/constants/deals';

const mockReplace = jest.fn();
const mockToastCustom = jest.fn();
const mockToastError = jest.fn();
const mockFetch = jest.fn();

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
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    (global as any).fetch = mockFetch;
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

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

  it('hides terminated deal-stage label on agent table when referral is active', () => {
    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-3',
            createdAt: new Date().toISOString(),
            borrowerName: 'Test Borrower 3',
            borrowerEmail: 'borrower3@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-3',
            status: 'Active Lead',
            dealStatusLabel: 'Terminated',
          },
        ]}
      />
    );

    expect(screen.queryByText('Deal stage: Terminated')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Active Lead')).toBeInTheDocument();
  });

  it('sends source=referral_table on non-terminated status updates', async () => {
    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-4',
            createdAt: new Date().toISOString(),
            borrowerName: 'Test Borrower 4',
            borrowerEmail: 'borrower4@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-4',
            status: 'Active Lead',
          },
        ]}
      />
    );

    const statusSelect = screen.getByDisplayValue('Active Lead');
    fireEvent.change(statusSelect, { target: { value: 'Paired' } });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/referrals/ref-4/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Paired',
            source: 'referral_table',
            terminatedReason: null,
          }),
        })
      );
    });
  });

  it('sends source=referral_table on terminated confirm flow', async () => {
    const terminatedReason = TERMINATED_REASON_OPTIONS[0]?.value;
    expect(terminatedReason).toBeTruthy();

    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-5',
            createdAt: new Date().toISOString(),
            borrowerName: 'Test Borrower 5',
            borrowerEmail: 'borrower5@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-5',
            status: 'Active Lead',
          },
        ]}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Active Lead'), { target: { value: 'Terminated' } });
    fireEvent.change(screen.getByDisplayValue('Select reason'), { target: { value: terminatedReason } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/referrals/ref-5/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Terminated',
            source: 'referral_table',
            terminatedReason,
          }),
        })
      );
    });
  });
});
