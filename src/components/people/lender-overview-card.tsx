'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { CopyButton } from '@/components/common/copy-button';
import { formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { LenderAdminEditor, type LenderAdminEditorProps } from '@/components/people/lender-admin-editor';
import { SendWelcomeEmailButton } from '@/components/people/send-welcome-email-button';
import { promptInactiveMetricsChoice } from '@/components/people/inactive-metrics-toast';

interface LenderOverviewCardProps {
  lender: LenderAdminEditorProps['lender'];
  isAdmin: boolean;
}

export function LenderOverviewCard({ lender, isAdmin }: LenderOverviewCardProps) {
  const router = useRouter();
  const [showEditor, setShowEditor] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  const isActive = lender.active !== false;

  const patchStatus = async (active: boolean, includeInMetrics: boolean) => {
    if (togglingActive) return;
    setTogglingActive(true);
    try {
      const response = await fetch(`/api/lenders/${lender._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, includeInMetrics }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? 'Unable to update mortgage consultant status');
      }
      if (active) {
        toast.success('Mortgage consultant marked active');
      } else {
        toast.success(
          includeInMetrics
            ? 'Mortgage consultant marked inactive (kept in leaderboards)'
            : 'Mortgage consultant marked inactive (excluded from leaderboards)'
        );
      }
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update mortgage consultant status');
    } finally {
      setTogglingActive(false);
    }
  };

  const handleToggleActive = () => {
    if (togglingActive) return;
    if (isActive) {
      promptInactiveMetricsChoice({
        label: 'mortgage consultant',
        onChoose: (includeInMetrics) => {
          void patchStatus(false, includeInMetrics);
        },
      });
    } else {
      void patchStatus(true, true);
    }
  };

  return (
    <div className="rounded-md bg-surface-raised p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold text-foreground">{lender.name}</h1>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                isActive ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
              }`}
            >
              {isActive ? 'Active' : 'Inactive'}
            </span>
            {!isActive && lender.includeInMetrics === false && (
              <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                Excluded from leaderboards
              </span>
            )}
            <CopyButton value={lender.name} label="Copy name" />
          </div>
          <div className="mt-2 space-y-1 text-sm text-foreground-muted">
            <p className="flex items-center gap-1">
              Email{' '}
              <a
                href={buildGmailComposeUrl(lender.email)}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {lender.email}
              </a>
              <CopyButton value={lender.email} label="Copy email" />
            </p>
            <p className="flex items-center gap-1">
              Phone: {formatPhoneNumber(lender.phone) || '—'}
              {lender.phone && <CopyButton value={lender.phone} label="Copy phone" className="ml-1" />}
            </p>
            <p>NMLS ID: {lender.nmlsId || '—'}</p>
            {isAdmin && lender.npsScore !== null && lender.npsScore !== undefined && (
              <p>
                NPS Score:{' '}
                <span className="font-medium text-foreground">
                  {typeof lender.npsScore === 'number' ? lender.npsScore.toFixed(1) : '—'}
                </span>
              </p>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap justify-end gap-2">
            <SendWelcomeEmailButton
              endpoint={`/api/lenders/${lender._id}/welcome-email`}
              recipientEmail={lender.email}
              recipientName={lender.name}
            />
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={togglingActive}
              className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70 ${
                isActive
                  ? 'border border-danger/30 bg-danger-soft text-danger hover:bg-danger-soft'
                  : 'border border-success/30 bg-success-soft text-success hover:bg-success-soft'
              }`}
              title={
                isActive
                  ? 'Mark this mortgage consultant inactive so admins know not to use them'
                  : 'Mark this mortgage consultant active'
              }
            >
              {togglingActive ? 'Saving…' : isActive ? 'Mark inactive' : 'Mark active'}
            </button>
            <button
              type="button"
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover"
              onClick={() => setShowEditor((previous) => !previous)}
            >
              {showEditor ? 'Close edit' : 'Edit details'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 text-sm text-foreground-muted sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase text-foreground-subtle">Licensed States</p>
          <p className="font-medium text-foreground">{(lender.licensedStates ?? []).join(', ') || '—'}</p>
        </div>
      </div>

      {isAdmin && showEditor && (
        <div className="mt-6 border-t border-border pt-6">
          <LenderAdminEditor
            lender={lender}
            className="space-y-4"
            onSaved={() => setShowEditor(false)}
          />
        </div>
      )}
    </div>
  );
}
