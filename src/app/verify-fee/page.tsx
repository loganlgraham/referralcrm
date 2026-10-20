'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  FEE_VERIFICATION_FIELDS,
  feeVerificationFieldLabel,
  feeVerificationLandingView,
  type FeeVerificationAmounts,
  type FeeVerificationField,
  type FeeVerificationStatus,
} from '@/lib/fee-verification';
import { formatCurrency, formatCurrencyWhole, formatDateMST } from '@/utils/formatters';

interface VerificationDetails {
  status: FeeVerificationStatus;
  respondedAt: string | null;
  recipientName: string | null;
  borrowerName: string | null;
  propertyAddress: string | null;
  closingDate: string | null;
  amounts: FeeVerificationAmounts;
}

type ViewState = 'loading' | 'invalid' | 'review' | 'report' | 'confirmed' | 'reported';

const CARD_CLASS = 'w-full max-w-xl rounded-card bg-surface-raised p-8 shadow-lg ring-1 ring-border';

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-surface-subtle px-4 py-12">
      <div className={CARD_CLASS}>{children}</div>
    </main>
  );
}

function describeCurrentValue(field: FeeVerificationField, details: VerificationDetails): string {
  const { amounts } = details;
  switch (field) {
    case 'contractPrice':
      return formatCurrencyWhole(amounts.contractPriceCents);
    case 'commission':
      return amounts.isFlatFee
        ? `${formatCurrency(amounts.commissionCents)} flat fee`
        : `${(amounts.commissionPercent ?? 0).toFixed(2)}% (${formatCurrency(amounts.commissionCents)})`;
    case 'referralFee':
      return `${amounts.referralFeePercent.toFixed(2)}% (${formatCurrency(amounts.referralFeeCents)})`;
    case 'closingDate':
      return formatDateMST(details.closingDate);
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

function NumbersSummary({ details }: { details: VerificationDetails }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border bg-surface-subtle text-sm">
      {FEE_VERIFICATION_FIELDS.map((field) => (
        <div key={field} className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-foreground-muted">{feeVerificationFieldLabel(field)}</dt>
          <dd className="text-right font-medium text-foreground">{describeCurrentValue(field, details)}</dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <dt className="font-semibold text-foreground">Net commission to you</dt>
        <dd className="text-right text-base font-semibold text-success">
          {formatCurrency(details.amounts.netCommissionCents)}
        </dd>
      </div>
    </dl>
  );
}

function VerifyFeeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const initialAction = searchParams.get('action');

  const [view, setView] = useState<ViewState>('loading');
  const [details, setDetails] = useState<VerificationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Record<FeeVerificationField, boolean>>({
    contractPrice: false,
    commission: false,
    referralFee: false,
    closingDate: false,
  });
  const [correctValues, setCorrectValues] = useState<Record<FeeVerificationField, string>>({
    contractPrice: '',
    commission: '',
    referralFee: '',
    closingDate: '',
  });
  const [note, setNote] = useState('');
  const autoConfirmAttempted = useRef(false);

  const submit = useCallback(
    async (payload: Record<string, unknown>): Promise<boolean> => {
      if (!token) return false;
      setSubmitting(true);
      setError(null);
      try {
        const response = await fetch('/api/fee-verification/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, ...payload }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'Something went wrong. Please try again.');
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [token]
  );

  const handleConfirm = useCallback(async () => {
    if (await submit({ action: 'confirm' })) {
      setView('confirmed');
    }
  }, [submit]);

  useEffect(() => {
    if (!token) {
      setError('This link is missing its code.');
      setView('invalid');
      return;
    }

    fetch(`/api/fee-verification/validate?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.valid) {
          setError(data.error || 'This link is not valid.');
          setView('invalid');
          return;
        }
        setDetails(data as VerificationDetails);
        const landing = feeVerificationLandingView(data.status, initialAction);
        if (!landing || landing === 'invalid') {
          setError('A newer fee breakdown was emailed for this deal. Please use the links in the most recent email.');
          setView('invalid');
          return;
        }
        setView(landing);
      })
      .catch(() => {
        setError('We could not load this link. Please try again.');
        setView('invalid');
      });
  }, [token, initialAction]);

  useEffect(() => {
    if (view !== 'review' || initialAction !== 'confirm' || autoConfirmAttempted.current) return;
    autoConfirmAttempted.current = true;
    void handleConfirm();
  }, [view, initialAction, handleConfirm]);

  const handleReport = async (event: React.FormEvent) => {
    event.preventDefault();
    const corrections = FEE_VERIFICATION_FIELDS.filter((field) => selectedFields[field]).map((field) => ({
      field,
      correctValue: correctValues[field].trim(),
    }));
    if (corrections.some((c) => !c.correctValue)) {
      setError('Add the correct value for each number you checked.');
      return;
    }
    if (corrections.length === 0 && !note.trim()) {
      setError('Check the number that looks off, or add a note.');
      return;
    }
    if (await submit({ action: 'report', corrections, note: note.trim() || undefined })) {
      setView('reported');
    }
  };

  if (view === 'loading') {
    return (
      <PageShell>
        <p className="text-center text-foreground-muted">Loading your fee breakdown...</p>
      </PageShell>
    );
  }

  if (view === 'invalid' || !details) {
    return (
      <PageShell>
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Link Not Available</h1>
          <p className="text-sm text-foreground-muted">{error || 'This link is invalid or has expired.'}</p>
        </div>
      </PageShell>
    );
  }

  const firstName = details.recipientName?.trim().split(/\s+/)[0] || null;
  const clientName = details.borrowerName || 'your client';

  const header = (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Referral fee breakdown</p>
      <h1 className="mt-2 text-2xl font-semibold text-foreground">{clientName}</h1>
      {details.propertyAddress ? (
        <p className="mt-1 text-sm text-foreground-muted">{details.propertyAddress}</p>
      ) : null}
    </div>
  );

  if (view === 'confirmed') {
    return (
      <PageShell>
        <div className="space-y-6">
          {header}
          <div className="rounded-md bg-success-soft p-4 text-center text-sm text-success">
            Thanks{firstName ? `, ${firstName}` : ''}! You confirmed these numbers look correct.
          </div>
          <NumbersSummary details={details} />
          <p className="text-center text-sm text-foreground-muted">
            Spot something after all?{' '}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView('report');
              }}
              className="font-semibold text-foreground underline"
            >
              Let us know
            </button>
          </p>
        </div>
      </PageShell>
    );
  }

  if (view === 'reported') {
    return (
      <PageShell>
        <div className="space-y-6">
          {header}
          <div className="rounded-md bg-warning-soft p-4 text-center text-sm text-foreground">
            Thanks{firstName ? `, ${firstName}` : ''}. We sent your notes to our team, and someone will follow up
            to get the numbers fixed before closing.
          </div>
        </div>
      </PageShell>
    );
  }

  if (view === 'report') {
    return (
      <PageShell>
        <form onSubmit={handleReport} className="space-y-6">
          {header}
          <p className="text-sm text-foreground-muted">
            Check each number that looks off and tell us what it should be. Our team will review and send an updated
            breakdown.
          </p>
          <div className="space-y-3">
            {FEE_VERIFICATION_FIELDS.map((field) => (
              <div key={field} className="rounded-lg border border-border p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedFields[field]}
                    onChange={(event) =>
                      setSelectedFields((current) => ({ ...current, [field]: event.target.checked }))
                    }
                    className="mt-1 h-4 w-4"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-foreground">{feeVerificationFieldLabel(field)}</span>
                    <span className="block text-xs text-foreground-muted">
                      We have: {describeCurrentValue(field, details)}
                    </span>
                  </span>
                </label>
                {selectedFields[field] ? (
                  <input
                    type="text"
                    value={correctValues[field]}
                    onChange={(event) =>
                      setCorrectValues((current) => ({ ...current, [field]: event.target.value }))
                    }
                    placeholder="What it should be"
                    maxLength={200}
                    className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                ) : null}
              </div>
            ))}
          </div>
          <div>
            <label htmlFor="fee-note" className="block text-sm font-medium text-foreground">
              Anything else we should know? <span className="font-normal text-foreground-muted">(optional)</span>
            </label>
            <textarea
              id="fee-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={2000}
              className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </div>
          {error ? <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div> : null}
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Sending...' : 'Send to our team'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView('review');
              }}
              className="w-full rounded-md border border-border px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-surface-subtle"
            >
              Back
            </button>
          </div>
        </form>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="space-y-6">
        {header}
        <p className="text-sm text-foreground-muted">
          {firstName ? `Hi ${firstName}, do` : 'Do'} these numbers match your settlement statement?
        </p>
        <NumbersSummary details={details} />
        {error ? <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div> : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Yes, looks correct'}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setView('report');
            }}
            className="w-full rounded-md border border-border px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-surface-subtle"
          >
            Something looks off
          </button>
        </div>
      </div>
    </PageShell>
  );
}

export default function VerifyFeePage() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <p className="text-center text-foreground-muted">Loading your fee breakdown...</p>
        </PageShell>
      }
    >
      <VerifyFeeContent />
    </Suspense>
  );
}
