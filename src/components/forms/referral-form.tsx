'use client';

import { ChangeEvent, FocusEvent, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { REFERRAL_TIMELINE_VALUES, REFERRAL_TIMELINE_OPTIONS } from '@/constants/referrals';
import { formatPhoneInput } from '@/utils/formatters';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FieldGrid, FieldGroup, FieldLabel, selectFieldClasses } from '@/components/ui/field-group';

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
  borrowerCurrentAddress: z.string().optional(),
  stageOnTransfer: z.enum(STAGE_OPTIONS),
  loanFileNumber: z.string().optional(),
  initialNotes: z.string().optional(),
  loanType: z.string().optional(),
  preApprovalAmount: z
    .number()
    .min(0, 'Pre-approval amount must be positive')
    .optional(),
  timeline: z.enum(REFERRAL_TIMELINE_VALUES).optional(),
});

// Use the robust formatPhoneInput utility which handles various formats including paste events

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
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [borrowerPhone, setBorrowerPhone] = useState('');
  const [selectedStage, setSelectedStage] = useState<StageOption>('Pre-approval TBD');
  const [sourceHistory, setSourceHistory] = useState<string[]>([]);
  const [endorserHistory, setEndorserHistory] = useState<string[]>([]);
  const [sourceValue, setSourceValue] = useState('');
  const [endorserValue, setEndorserValue] = useState('');
  const stageOptions = useMemo(() => STAGE_OPTIONS, []);
  const userRole = session?.user?.role ?? null;
  const isAgent = userRole === 'agent';
  const isAdmin = userRole === 'admin';
  const prefillZip = (() => {
    const zip = searchParams.get('zip')?.trim() ?? '';
    return /^\d{5}$/u.test(zip) ? zip : '';
  })();
  const prefillNotes = searchParams.get('notes')?.trim() ?? '';

  const parseZipList = (value: string): string[] =>
    Array.from(
      new Set(
        value
          .split(',')
          .map((zip) => zip.trim())
          .filter((zip) => /^\d{5}$/u.test(zip))
      )
    );

  useEffect(() => {
    if (!isAdmin) return;

    const fetchMetadata = async () => {
      try {
        const response = await fetch('/api/referrals/metadata');
        if (response.ok) {
          const data = (await response.json()) as { sources: string[]; endorsers: string[] };
          setSourceHistory(data.sources);
          setEndorserHistory(data.endorsers);
        }
      } catch (error) {
        console.error('Failed to fetch referral metadata', error);
      }
    };

    fetchMetadata();
  }, [isAdmin]);

  const handleSourceChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setSourceValue(value);
  };

  const handleEndorserChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setEndorserValue(value);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const stageOnTransfer: StageOption = isAgent
      ? 'Pre-approval TBD'
      : ((formData.get('stageOnTransfer')?.toString() as StageOption) || 'Pre-approval TBD');

    const payload = {
      borrowerFirstName: (formData.get('borrowerFirstName')?.toString() ?? '').trim(),
      borrowerLastName: (formData.get('borrowerLastName')?.toString() ?? '').trim(),
      borrowerEmail: (formData.get('borrowerEmail')?.toString() ?? '').trim(),
      borrowerPhone: (formData.get('borrowerPhone')?.toString() ?? '').trim(),
      source: (formData.get('source')?.toString() ?? '').trim(),
      endorser: (formData.get('endorser')?.toString() ?? '').trim(),
      clientType: isAgent
        ? ('Buyer' as ClientTypeOption)
        : ((formData.get('clientType')?.toString() as ClientTypeOption) || 'Buyer'),
      lookingInZip: (formData.get('lookingInZip')?.toString() ?? '').trim(),
      borrowerCurrentAddress: isAgent
        ? ''
        : (formData.get('borrowerCurrentAddress')?.toString() ?? '').trim(),
      stageOnTransfer,
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

    // Metadata is automatically saved to database by the API endpoint

    const loanFileNumber = result.data.loanFileNumber?.trim() ?? '';

    if (isAdmin) {
      if (!result.data.source?.trim()) {
        toast.error('Add a referral source');
        return;
      }
      if (!result.data.endorser?.trim()) {
        toast.error('Add an endorser');
        return;
      }
    }

    if (!isAgent) {
      if (!loanFileNumber) {
        toast.error('Add a loan file number');
        return;
      }
      if (!result.data.borrowerCurrentAddress?.trim()) {
        toast.error("Add the borrower's current address");
        return;
      }
    }

    const body: Record<string, unknown> = {
      borrowerFirstName: result.data.borrowerFirstName,
      borrowerLastName: result.data.borrowerLastName,
      borrowerEmail: result.data.borrowerEmail,
      borrowerPhone: result.data.borrowerPhone,
      clientType: isAgent ? 'Buyer' : result.data.clientType,
      lookingInZip: zipList[0],
      lookingInZips: zipList,
      borrowerCurrentAddress: isAgent ? '' : (result.data.borrowerCurrentAddress?.trim() ?? ''),
      stageOnTransfer: result.data.stageOnTransfer,
    };

    if (isAdmin) {
      body.source = result.data.source?.trim() ?? '';
      body.endorser = result.data.endorser?.trim() ?? '';
    }

    if (loanFileNumber) {
      body.loanFileNumber = loanFileNumber;
    }

    if (result.data.loanType?.trim()) {
      body.loanType = result.data.loanType.trim();
    }
    if (result.data.initialNotes?.trim()) {
      body.initialNotes = result.data.initialNotes.trim();
    }

    if (result.data.timeline) {
      body.timeline = result.data.timeline;
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
        if (response.status === 409) {
          const data = (await response.json()) as {
            message: string;
            existingReferralId: string;
            existingBorrowerName: string;
          };
          toast.error(
            `${data.message} (${data.existingBorrowerName})`,
            { duration: 5000 }
          );
          // Navigate to existing referral
          router.push(`/referrals/${data.existingReferralId}`);
        } else {
          toast.error('Unable to create referral');
        }
        return;
      }

      const { id } = (await response.json()) as { id: string };
      toast.success(
        isAgent
          ? 'Thanks — we got your intro. Check your email for confirmation, and we’ll email again when an MC is paired.'
          : 'Referral created'
      );
      router.push(`/referrals/${id}`);
    } catch (error) {
      console.error(error);
      toast.error('Unable to create referral');
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneInput(event.target.value);
    setBorrowerPhone(formatted);
  };

  const handlePhonePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pastedText = event.clipboardData.getData('text');
    const formatted = formatPhoneInput(pastedText);
    setBorrowerPhone(formatted);
    // Update the input value directly
    const target = event.currentTarget;
    target.value = formatted;
  };

  const handleStageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedStage(event.target.value as StageOption);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <FieldGroup title="Borrower information">
        <FieldGrid>
          <label className="block space-y-1.5">
            <FieldLabel label="First name" />
            <Input name="borrowerFirstName" required autoComplete="given-name" />
          </label>
          <label className="block space-y-1.5">
            <FieldLabel label="Last name" />
            <Input name="borrowerLastName" required autoComplete="family-name" />
          </label>
          <label className="block space-y-1.5">
            <FieldLabel label="Email" />
            <Input name="borrowerEmail" type="email" required autoComplete="email" />
          </label>
          <label className="block space-y-1.5">
            <FieldLabel label="Phone" />
            <Input
              name="borrowerPhone"
              required
              inputMode="tel"
              maxLength={14}
              pattern="\d{3}-\d{3}-\d{4}"
              value={borrowerPhone}
              onChange={handlePhoneChange}
              onPaste={handlePhonePaste}
              className="text-numeric"
              placeholder="555-123-4567"
            />
          </label>
        </FieldGrid>
      </FieldGroup>

      <FieldGroup title="Referral details">
        <FieldGrid>
          {isAdmin && (
            <>
              <label className="block space-y-1.5">
                <FieldLabel label="Source" />
                <Input
                  name="source"
                  placeholder="e.g. Past client, Open house"
                  value={sourceValue}
                  onChange={handleSourceChange}
                  list={sourceHistory.length > 0 ? 'source-history' : undefined}
                />
                {sourceHistory.length > 0 ? (
                  <datalist id="source-history">
                    {sourceHistory.map((entry) => (
                      <option key={entry} value={entry} />
                    ))}
                  </datalist>
                ) : null}
              </label>
              <label className="block space-y-1.5">
                <FieldLabel label="Endorser" />
                <Input
                  name="endorser"
                  placeholder="Who sent this referral?"
                  value={endorserValue}
                  onChange={handleEndorserChange}
                  list={endorserHistory.length > 0 ? 'endorser-history' : undefined}
                />
                {endorserHistory.length > 0 ? (
                  <datalist id="endorser-history">
                    {endorserHistory.map((entry) => (
                      <option key={entry} value={entry} />
                    ))}
                  </datalist>
                ) : null}
              </label>
            </>
          )}
          {!isAgent && (
            <label className="block space-y-1.5">
              <FieldLabel label="Client type" />
              <select name="clientType" defaultValue="Buyer" className={selectFieldClasses}>
                {CLIENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isAgent && (
            <>
              <label className="block space-y-1.5">
                <FieldLabel label="Stage on transfer" />
                <select
                  name="stageOnTransfer"
                  value={selectedStage}
                  onChange={handleStageChange}
                  className={selectFieldClasses}
                >
                  {stageOptions.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <FieldLabel label="Loan file number" />
                <Input name="loanFileNumber" required className="text-numeric" />
              </label>
              <label className="block space-y-1.5">
                <FieldLabel label="Loan type" />
                <Input name="loanType" placeholder="Conventional, FHA, VA…" />
              </label>
              <label className="block space-y-1.5">
                <FieldLabel label="Pre-approval amount" />
                <div className="relative">
                  <span
                    aria-hidden
                    className="text-numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-subtle"
                  >
                    $
                  </span>
                  <Input
                    name="preApprovalAmount"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9,]*"
                    className="text-numeric pl-7 font-medium"
                    placeholder="300,000"
                    onFocus={handleCurrencyFocus}
                    onBlur={handleCurrencyBlur}
                  />
                </div>
              </label>
            </>
          )}
          <label className="block space-y-1.5">
            <FieldLabel label="Looking in (ZIP)" />
            <Input
              name="lookingInZip"
              required
              autoComplete="postal-code"
              placeholder="e.g. 80202, 80216, 80021"
              className="text-numeric"
              defaultValue={prefillZip}
            />
          </label>
          <label className="block space-y-1.5">
            <FieldLabel label="Timeline" />
            <select name="timeline" className={selectFieldClasses} defaultValue="not_specified">
              {REFERRAL_TIMELINE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {!isAgent && (
            <label className="block space-y-1.5 sm:col-span-2">
              <FieldLabel label="Borrower current address" />
              <Input name="borrowerCurrentAddress" required autoComplete="street-address" />
            </label>
          )}
        </FieldGrid>
      </FieldGroup>

      <FieldGroup
        title="Notes for the team"
        description={
          isAgent
            ? 'Share anything that helps the mortgage consultant — budget range, urgency, special circumstances, and your preferred MC if you have one.'
            : "These notes will land in the referral's conversation thread so everyone has the same context from the start."
        }
      >
        <Textarea
          name="initialNotes"
          rows={4}
          className="min-h-[120px] resize-y"
          placeholder={
            isAgent
              ? 'e.g. Preferred MC: Jordan Smith. First-time buyer, hoping to close before school starts…'
              : 'Share helpful context, deadlines, or next steps'
          }
          defaultValue={prefillNotes}
        />
      </FieldGroup>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground-muted">
          Double-check the details before saving. You can always fine-tune anything after the
          referral is created.
        </p>
        <Button type="submit" size="lg" loading={loading} className="shrink-0">
          {loading ? 'Creating…' : 'Create referral'}
        </Button>
      </div>
    </form>
  );
}
