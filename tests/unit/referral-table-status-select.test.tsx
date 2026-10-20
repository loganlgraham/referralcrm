import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReferralTable } from '@/components/tables/referral-table';
import { TERMINATED_REASON_OPTIONS } from '@/constants/deals';
import { LOST_REASON_OPTIONS } from '@/constants/referrals';
import { confirmReferralTermination } from '@/components/referrals/terminate-confirmation-toast';

const mockReplace = jest.fn();
const mockRefresh = jest.fn();
const mockToastCustom = jest.fn();
const mockToastError = jest.fn();
const mockFetch = jest.fn();
const mockedConfirmReferralTermination = confirmReferralTermination as jest.MockedFunction<
  typeof confirmReferralTermination
>;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
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

jest.mock('@/components/referrals/status-date-confirmation-toast', () => ({
  confirmCloseStatusDate: jest.fn(async () => ({
    confirmed: true,
    closingDateIso: null,
  })),
}));

jest.mock('@/components/referrals/terminate-confirmation-toast', () => ({
  confirmReferralTermination: jest.fn(),
}));

describe('ReferralTable agent status actions', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ deal: { status: 'closed' } }),
    });
    (global as any).fetch = mockFetch;
  });

  afterEach(() => {
    mockFetch.mockReset();
    mockRefresh.mockReset();
    mockedConfirmReferralTermination.mockReset();
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

  it('formats contract price and preserves numeric value when submitting under-contract details', async () => {
    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-price-format',
            createdAt: new Date().toISOString(),
            borrowerName: 'Price Borrower',
            borrowerEmail: 'price@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-price',
            status: 'Active Lead',
          },
        ]}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Active Lead'), { target: { value: 'Under Contract' } });

    const toastRenderer = mockToastCustom.mock.calls.at(-1)?.[0] as ((toastRef: unknown) => JSX.Element) | undefined;
    expect(toastRenderer).toBeDefined();
    if (!toastRenderer) {
      return;
    }
    render(toastRenderer({ id: 'toast-price' }));

    const contractPriceField = screen.getByText('Contract price').closest('label')?.querySelector('input');
    expect(contractPriceField).toBeTruthy();
    if (!contractPriceField) {
      return;
    }
    const contractPriceInput = contractPriceField as HTMLInputElement;
    fireEvent.change(contractPriceInput, { target: { value: '450000' } });
    expect(contractPriceInput).toHaveValue('450,000');

    fireEvent.change(screen.getByLabelText('Referral fee %'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Property address'), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByLabelText('Property city'), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText('Property state'), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText('Property ZIP'), { target: { value: '80014' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save deal & move status' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/referrals/ref-price-format/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const statusRequestCall = mockFetch.mock.calls.find(
      (call) => call[0] === '/api/referrals/ref-price-format/status'
    );
    expect(statusRequestCall).toBeDefined();
    const statusRequestBody = JSON.parse(String(statusRequestCall?.[1]?.body));
    expect(statusRequestBody.contractDetails.contractPrice).toBe(450000);
  });

  it('captures commission percent for agent-origin under-contract deals', async () => {
    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-agent-commission',
            createdAt: new Date().toISOString(),
            borrowerName: 'Agent Origin Borrower',
            borrowerEmail: 'agent-origin@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-agent-commission',
            status: 'Active Lead',
            origin: 'agent',
          },
        ]}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Active Lead'), { target: { value: 'Under Contract' } });

    const toastRenderer = mockToastCustom.mock.calls.at(-1)?.[0] as ((toastRef: unknown) => JSX.Element) | undefined;
    expect(toastRenderer).toBeDefined();
    if (!toastRenderer) {
      return;
    }
    render(toastRenderer({ id: 'toast-agent-commission' }));

    expect(screen.getByText('Commission %')).toBeInTheDocument();
    expect(screen.queryByLabelText('Referral fee %')).not.toBeInTheDocument();

    const contractPriceField = screen.getByText('Contract price').closest('label')?.querySelector('input');
    expect(contractPriceField).toBeTruthy();
    if (!contractPriceField) {
      return;
    }
    fireEvent.change(contractPriceField as HTMLInputElement, { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText('Commission %'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Property address'), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByLabelText('Property city'), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText('Property state'), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText('Property ZIP'), { target: { value: '80014' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save deal & move status' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/payments',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const paymentRequestCall = mockFetch.mock.calls.find((call) => call[0] === '/api/payments');
    expect(paymentRequestCall).toBeDefined();
    const paymentRequestBody = JSON.parse(String(paymentRequestCall?.[1]?.body));
    expect(paymentRequestBody.commissionBasisPoints).toBe(250);

    const statusRequestCall = mockFetch.mock.calls.find(
      (call) => call[0] === '/api/referrals/ref-agent-commission/status'
    );
    expect(statusRequestCall).toBeDefined();
    const statusRequestBody = JSON.parse(String(statusRequestCall?.[1]?.body));
    expect(statusRequestBody.contractDetails.agentCommissionPercentage).toBe(2.5);
  });

  it('updates both-side status pill immediately after under-contract save', async () => {
    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-both-under-contract',
            createdAt: new Date().toISOString(),
            borrowerName: 'Both Borrower',
            borrowerEmail: 'both@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Both',
            viewerAssignedSide: 'buy',
            buyStatus: 'Active Lead',
            sellStatus: 'Under Contract',
            lookingInZip: '80014',
            loanFileNumber: 'L-both',
            status: 'Active Lead',
          },
        ]}
      />
    );

    const buyLabel = screen.getByText('Buy');
    const buyPill = buyLabel.closest('div');
    expect(buyPill).toBeTruthy();
    if (!buyPill) {
      return;
    }

    expect(within(buyPill).getByText('Active Lead')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Active Lead'), { target: { value: 'Under Contract' } });

    const toastRenderer = mockToastCustom.mock.calls.at(-1)?.[0] as ((toastRef: unknown) => JSX.Element) | undefined;
    expect(toastRenderer).toBeDefined();
    if (!toastRenderer) {
      return;
    }
    render(toastRenderer({ id: 'toast-both-under-contract' }));

    const contractPriceField = screen.getByText('Contract price').closest('label')?.querySelector('input');
    expect(contractPriceField).toBeTruthy();
    if (!contractPriceField) {
      return;
    }
    fireEvent.change(contractPriceField, { target: { value: '450000' } });
    fireEvent.change(screen.getByLabelText('Referral fee %'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Property address'), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByLabelText('Property city'), { target: { value: 'Denver' } });
    fireEvent.change(screen.getByLabelText('Property state'), { target: { value: 'CO' } });
    fireEvent.change(screen.getByLabelText('Property ZIP'), { target: { value: '80014' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save deal & move status' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/referrals/ref-both-under-contract/status',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    expect(within(buyPill).getByText('Under Contract')).toBeInTheDocument();
  });

  it('opens still-shopping toast for terminated instead of a native prompt', async () => {
    mockedConfirmReferralTermination.mockResolvedValueOnce({ confirmed: false });
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
            status: 'Under Contract',
            dealStatusLabel: 'Under Contract',
          },
        ]}
      />
    );

    const statusSelect = screen.getByDisplayValue('Under Contract');
    fireEvent.change(statusSelect, { target: { value: 'Terminated' } });

    await waitFor(() => {
      expect(mockedConfirmReferralTermination).toHaveBeenCalledWith({
        borrowerName: 'Test Borrower 2',
        isAgentOrigin: false,
      });
    });
    expect(screen.getByDisplayValue('Under Contract')).toBeInTheDocument();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
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
            sendClosedEmails: false,
            sendAgentNpsEmail: false,
          }),
        })
      );
    });
  });

  it('reconciles status from deal response when closing from agent table', async () => {
    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-closed-sync',
            createdAt: new Date().toISOString(),
            borrowerName: 'Closed Sync Borrower',
            borrowerEmail: 'sync@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-closed',
            status: 'Active Lead',
            dealStatusLabel: 'Under Contract',
          },
        ]}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Active Lead'), { target: { value: 'Closed' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Closed')).toBeInTheDocument();
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('sends Active Lead + terminateDeal when customer is still shopping', async () => {
    const terminatedReason = TERMINATED_REASON_OPTIONS[0]?.value;
    expect(terminatedReason).toBeTruthy();
    mockedConfirmReferralTermination.mockResolvedValueOnce({
      confirmed: true,
      resolvedStatus: 'Active Lead',
      terminatedReason,
      lostReason: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'Active Lead', deal: { status: 'terminated' } }),
    });

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
            status: 'Under Contract',
            dealStatusLabel: 'Under Contract',
          },
        ]}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Under Contract'), { target: { value: 'Terminated' } });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/referrals/ref-5/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Active Lead',
            source: 'referral_table',
            terminatedReason,
            lostReason: null,
            terminateDeal: true,
          }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Active Lead')).toBeInTheDocument();
      expect(mockRefresh).toHaveBeenCalled();
      expect(screen.queryByText('Deal stage: Under Contract')).not.toBeInTheDocument();
    });
  });

  it('sends Lost + terminateDeal when customer is not still shopping', async () => {
    const terminatedReason = TERMINATED_REASON_OPTIONS[1]?.value ?? TERMINATED_REASON_OPTIONS[0]?.value;
    expect(terminatedReason).toBeTruthy();
    const lostReason = LOST_REASON_OPTIONS[0]?.value;
    expect(lostReason).toBeTruthy();
    mockedConfirmReferralTermination.mockResolvedValueOnce({
      confirmed: true,
      resolvedStatus: 'Lost',
      terminatedReason,
      lostReason,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'Lost', deal: { status: 'terminated' } }),
    });

    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-6',
            createdAt: new Date().toISOString(),
            borrowerName: 'Test Borrower 6',
            borrowerEmail: 'borrower6@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-6',
            status: 'Under Contract',
            dealStatusLabel: 'Under Contract',
          },
        ]}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Under Contract'), { target: { value: 'Terminated' } });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/referrals/ref-6/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Lost',
            source: 'referral_table',
            terminatedReason,
            lostReason,
            terminateDeal: true,
          }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Lost')).toBeInTheDocument();
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('sends In Communication + terminateDeal when shopping answer is maybe', async () => {
    const terminatedReason = TERMINATED_REASON_OPTIONS[0]?.value;
    expect(terminatedReason).toBeTruthy();
    mockedConfirmReferralTermination.mockResolvedValueOnce({
      confirmed: true,
      resolvedStatus: 'In Communication',
      terminatedReason,
      lostReason: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'In Communication', deal: { status: 'terminated' } }),
    });

    render(
      <ReferralTable
        mode="agent"
        data={[
          {
            _id: 'ref-7',
            createdAt: new Date().toISOString(),
            borrowerName: 'Test Borrower 7',
            borrowerEmail: 'borrower7@example.com',
            borrowerPhone: '1234567890',
            clientType: 'Buyer',
            lookingInZip: '80014',
            loanFileNumber: 'L-7',
            status: 'Under Contract',
            dealStatusLabel: 'Under Contract',
          },
        ]}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Under Contract'), { target: { value: 'Terminated' } });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/referrals/ref-7/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'In Communication',
            source: 'referral_table',
            terminatedReason,
            lostReason: null,
            terminateDeal: true,
          }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('In Communication')).toBeInTheDocument();
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
