'use client';

import { useState } from 'react';

import { CopyButton } from '@/components/common/copy-button';
import { formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { LenderAdminEditor, type LenderAdminEditorProps } from '@/components/people/lender-admin-editor';
import { SendWelcomeEmailButton } from '@/components/people/send-welcome-email-button';

interface LenderOverviewCardProps {
  lender: LenderAdminEditorProps['lender'];
  isAdmin: boolean;
}

export function LenderOverviewCard({ lender, isAdmin }: LenderOverviewCardProps) {
  const [showEditor, setShowEditor] = useState(false);

  return (
    <div className="rounded-md bg-surface-raised p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold text-foreground">{lender.name}</h1>
            <CopyButton value={lender.name} label="Copy name" />
          </div>
          <div className="mt-2 space-y-1 text-sm text-foreground-muted">
            <p className="flex items-center gap-1">
              Email{' '}
              <a
                href={buildGmailComposeUrl(lender.email)}
                target="_blank"
                rel="noreferrer"
                className="text-primary-700 hover:underline"
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
              className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
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
