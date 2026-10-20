'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';

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
    <>
      <PageHeader
        breadcrumbs={
          <span className="flex items-center gap-1.5">
            <Link href="/lenders" className="text-foreground-muted hover:text-foreground">
              Mortgage consultants
            </Link>
            <span aria-hidden>/</span>
            <span className="truncate">{lender.name}</span>
          </span>
        }
        eyebrow={isActive ? 'Active' : 'Inactive'}
        title={lender.name}
        actions={
          <>
            <CopyButton value={lender.name} label="Copy name" />
            {!isActive && lender.includeInMetrics === false && (
              <span className="text-eyebrow inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-warning">
                Excluded from leaderboards
              </span>
            )}
            {isAdmin && (
              <>
                <SendWelcomeEmailButton
                  endpoint={`/api/lenders/${lender._id}/welcome-email`}
                  recipientEmail={lender.email}
                  recipientName={lender.name}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleToggleActive}
                  loading={togglingActive}
                  title={
                    isActive
                      ? 'Mark this mortgage consultant inactive so admins know not to use them'
                      : 'Mark this mortgage consultant active'
                  }
                >
                  {togglingActive ? 'Saving…' : isActive ? 'Mark inactive' : 'Mark active'}
                </Button>
                <Button type="button" onClick={() => setShowEditor((previous) => !previous)}>
                  {showEditor ? 'Close edit' : 'Edit details'}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
        <div className="space-y-1 text-sm text-foreground-muted">
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
            Phone: <span className="text-numeric">{formatPhoneNumber(lender.phone) || '—'}</span>
            {lender.phone && <CopyButton value={lender.phone} label="Copy phone" className="ml-1" />}
          </p>
          <p>
            NMLS ID: <span className="text-numeric">{lender.nmlsId || '—'}</span>
          </p>
          {isAdmin && lender.npsScore !== null && lender.npsScore !== undefined && (
            <p>
              NPS Score:{' '}
              <span className="text-numeric font-medium text-foreground">
                {typeof lender.npsScore === 'number' ? lender.npsScore.toFixed(1) : '—'}
              </span>
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-3 text-sm text-foreground-muted sm:grid-cols-2">
          <div>
            <p className="text-eyebrow text-foreground-subtle">Licensed states</p>
            <p className="mt-0.5 font-medium text-foreground">{(lender.licensedStates ?? []).join(', ') || '—'}</p>
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
    </>
  );
}
