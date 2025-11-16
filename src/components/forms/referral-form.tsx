'use client';

import { FocusEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';

const STAGE_OPTIONS = ['Pre-approval TBD', 'Pre-approved'] as const;
const CLIENT_TYPE_OPTIONS = [
  { value: 'Buyer', label: 'Buyer' },
  { value: 'Seller', label: 'Seller' },
  { value: 'Both', label: 'Both (buying & selling)' }
] as const;

type StageOption = (typeof STAGE_OPTIONS)[number];
type ClientTypeOption = (typeof CLIENT_TYPE_OPTIONS)[number]['value'];

const zipListPattern = /^\s*\d{5}(?:\s*,\s*\d{5})*\s*$/u;

const referralSchema = z.object({
  borrowerFirstName: z.string().min(1, 'Enter the borrower\'s first name'),
  borrowerLastName: z.string().min(1, 'Enter the borrower\'s last name'),
  borrowerEmail: z.string().email('Enter a valid email address'),
  borrowerPhone: z
    .string()
    .regex(/^[0-9]{3}-[0-9]{3}-[0-9]{4}$/u, 'Enter a 10-digit phone number'),
  source: z.string().optional(),
  endorser: z.string().optional(),
  clientType: z.enum(['Seller', 'Buyer', 'Both']),
  lookingInZip: z
    .string()
    .regex(zipListPattern, 'Enter one or more 5-digit ZIP codes separated by commas'),
  borrowerCurrentAddress: z.string().min(1, 'Add the borrower\'s current address'),
  stageOnTransfer: z.enum(STAGE_OPTIONS),
  loanFileNumber: z.string().min(1, 'Loan file number is required'),
  initialNotes: z.string().optional(),
  loanType: z.string().optional(),
  preApprovalAmount: z
    .number()
    .min(0, 'Pre-approval amount must be positive')
    .optional(),
});

const inputClasses =
  'mt-2 w-full rounded-lg border border-slate-300/80 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 focus:ring-offset-white';

const labelClasses = 'flex flex-col text-sm font-medium text-slate-700';

const formatPhoneNumber = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  const area = digits.slice(0, 3);
  const prefix = digits.slice(3, 6);
  const line = digits.slice(6, 10);

  if (digits.length <= 3) {
    return area;
  }
  if (digits.length <= 6) {
    return `${area}-${prefix}`;
  }
  return `${area}-${prefix}-${line}`;
};

const formatCurrencyInputValue = (value: string) => {
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) {
    return '';
  }

  const amount = Number(digits);
  if (Number.isNaN(amount)) {
    return '';
  }

  return amount.toLocaleString('en-US');
};

const parseCurrencyInput = (value: FormDataEntryValue | null | undefined) => {
  if (value == null) {
    return undefined;
  }

  const digits = value.toString().replace(/[^0-9]/g, '');
  if (!digits) {
    return undefined;
  }

  const amount = Number(digits);
  return Number.isNaN(amount) ? undefined : amount;
};

const handleCurrencyFocus = (event: FocusEvent<HTMLInputElement>) => {
  event.currentTarget.value = event.currentTarget.value.replace(/,/g, '');
};

const handleCurrencyBlur = (event: FocusEvent<HTMLInputElement>) => {
  event.currentTarget.value = formatCurrencyInputValue(event.currentTarget.value);
};

export function ReferralForm() {
  const router = useRouter();
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [borrowerPhone, setBorrowerPhone] = useState('');
  const [selectedStage, setSelectedStage] = useState<StageOption>('Pre-approval TBD');
  const stageOptions = useMemo(() => STAGE_OPTIONS, []);
  const userRole = session?.user?.role ?? null;
  const isAgent = userRole === 'agent';

  const parseZipList = (value: string): string[] =>
    Array.from(
      new Set(
        value
          .split(',')
          .map((zip) => zip.trim())
          .filter((zip) => /^\d{5}$/u.test(zip))
      )
    );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const payload = {
      borrowerFirstName: (formData.get('borrowerFirstName')?.toString() ?? '').trim(),
      borrowerLastName: (formData.get('borrowerLastName')?.toString() ?? '').trim(),
      borrowerEmail: (formData.get('borrowerEmail')?.toString() ?? '').trim(),
      borrowerPhone: (formData.get('borrowerPhone')?.toString() ?? '').trim(),
      source: (formData.get('source')?.toString() ?? '').trim(),
      endorser: (formData.get('endorser')?.toString() ?? '').trim(),
      clientType: (formData.get('clientType')?.toString() as ClientTypeOption) || 'Buyer',
      lookingInZip: (formData.get('lookingInZip')?.toString() ?? '').trim(),
      borrowerCurrentAddress: (formData.get('borrowerCurrentAddress')?.toString() ?? '').trim(),
      stageOnTransfer: (formData.get('stageOnTransfer')?.toString() as StageOption) || 'Pre-approval TBD',
      loanFileNumber: (formData.get('loanFileNumber')?.toString() ?? '').trim(),
      initialNotes: formData.get('initialNotes')?.toString(),
      loanType: formData.get('loanType')?.toString(),
      preApprovalAmount: parseCurrencyInput(formData.get('preApprovalAmount')),
    };

    const result = referralSchema.safeParse(payload);
    if (!result.success) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    const zipList = parseZipList(result.data.lookingInZip);
    if (zipList.length === 0) {
      toast.error('Add at least one 5-digit ZIP code.');
      return;
    }

    if (!isAgent) {
      if (!result.data.source?.trim()) {
        toast.error('Add a referral source');
        return;
      }
      if (!result.data.endorser?.trim()) {
        toast.error('Add an endorser');
        return;
      }
    }

    const body: Record<string, unknown> = {
      borrowerFirstName: result.data.borrowerFirstName,
      borrowerLastName: result.data.borrowerLastName,
      borrowerEmail: result.data.borrowerEmail,
      borrowerPhone: result.data.borrowerPhone,
      clientType: result.data.clientType,
      lookingInZip: zipList[0],
      lookingInZips: zipList,
      borrowerCurrentAddress: result.data.borrowerCurrentAddress,
      stageOnTransfer: result.data.stageOnTransfer,
      loanFileNumber: result.data.loanFileNumber,
    };

    if (!isAgent) {
      body.source = result.data.source?.trim() ?? '';
      body.endorser = result.data.endorser?.trim() ?? '';
    }

    if (result.data.loanType?.trim()) {
      body.loanType = result.data.loanType.trim();
    }
    if (result.data.initialNotes?.trim()) {
      body.initialNotes = result.data.initialNotes.trim();
    }
    if (typeof result.data.preApprovalAmount === 'number') {
      body.preApprovalAmount = result.data.preApprovalAmount;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('Failed to create referral');
      }

      const { id } = (await response.json()) as { id: string };
      toast.success('Referral created');
      router.push(`/referrals/${id}`);
    } catch (error) {
      console.error(error);
      toast.error('Unable to create referral');
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(event.target.value);
    setBorrowerPhone(formatted);
  };

  const handleStageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedStage(event.target.value as StageOption);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-200/70 ring-1 ring-slate-100">
        <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-50 to-slate-100 px-6 py-6 sm:px-8">
          <h1 className="text-2xl font-semibold text-slate-900">Start a new referral</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            {isAgent
              ? 'Share your client’s details so our mortgage consultants can connect quickly and keep you in the loop.'
              : "Capture the borrower's details, context, and pre-approval information so teammates can jump in without missing a beat."}
          </p>
        </div>

        <div className="space-y-8 px-6 py-6 sm:px-8 sm:py-8">
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Borrower information
            </legend>
            <div className="grid gap-4 md:grid-cols-2">
              <label className={labelClasses}>
                First name
                <input
                  name="borrowerFirstName"
                  required
                  autoComplete="given-name"
                  className={inputClasses}
                />
              </label>
              <label className={labelClasses}>
                Last name
                <input
                  name="borrowerLastName"
                  required
                  autoComplete="family-name"
                  className={inputClasses}
                />
              </label>
              <label className={labelClasses}>
                Email
                <input
                  name="borrowerEmail"
                  type="email"
                  required
                  autoComplete="email"
                  className={inputClasses}
                />
              </label>
              <label className={labelClasses}>
                Phone
                <input
                  name="borrowerPhone"
                  required
                  inputMode="tel"
                  maxLength={12}
                  pattern="\d{3}-\d{3}-\d{4}"
                  value={borrowerPhone}
                  onChange={handlePhoneChange}
                  className={inputClasses}
                  placeholder="555-123-4567"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Referral details
            </legend>
            <div className="grid gap-4 md:grid-cols-2">
              {!isAgent && (
                <>
                  <label className={labelClasses}>
                    Source
                    <input
                      name="source"
                      placeholder="e.g. Past client, Open house"
                      className={inputClasses}
                    />
                  </label>
                  <label className={labelClasses}>
                    Endorser
                    <input
                      name="endorser"
                      placeholder="Who sent this referral?"
                      className={inputClasses}
                    />
                  </label>
                </>
              )}
              <label className={labelClasses}>
                Client type
                <select
                  name="clientType"
                  defaultValue="Buyer"
                  className={inputClasses}
                >
                  {CLIENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClasses}>
                Stage on transfer
                <select
                  name="stageOnTransfer"
                  value={selectedStage}
                  onChange={handleStageChange}
                  className={inputClasses}
                >
                  {stageOptions.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClasses}>
                Loan file number
                <input name="loanFileNumber" required className={inputClasses} />
              </label>
              <label className={labelClasses}>
                Loan type
                <input name="loanType" placeholder="Conventional, FHA, VA…" className={inputClasses} />
              </label>
              <label className={labelClasses}>
                Pre-approval amount
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                    $
                  </span>
                  <input
                    name="preApprovalAmount"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9,]*"
                    className={`${inputClasses} pl-7`}
                    placeholder="300,000"
                    onFocus={handleCurrencyFocus}
                    onBlur={handleCurrencyBlur}
                  />
                </div>
              </label>
              <label className={labelClasses}>
                Looking in (ZIP)
                <input
                  name="lookingInZip"
                  required
                  autoComplete="postal-code"
                  placeholder="e.g. 80202, 80216, 80021"
                  className={inputClasses}
                />
              </label>
              <label className={`${labelClasses} md:col-span-2`}>
                Borrower current address
                <input
                  name="borrowerCurrentAddress"
                  required
                  autoComplete="street-address"
                  className={inputClasses}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Notes for the team
            </legend>
            <p className="text-xs text-slate-500">
              These notes will land in the referral\'s conversation thread so everyone has the same
              context from the start.
            </p>
            <textarea
              name="initialNotes"
              rows={4}
              className={`${inputClasses} min-h-[120px] resize-y`}
              placeholder="Share helpful context, deadlines, or next steps"
            />
          </fieldset>
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-200/80 bg-slate-50/80 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="text-sm text-slate-600">
            Double-check the details before saving. You can always fine-tune anything after the
            referral is created.
          </p>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Creating…' : 'Create referral'}
          </button>
        </div>
      </div>
    </form>
  );
}
