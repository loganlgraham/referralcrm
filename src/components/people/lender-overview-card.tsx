'use client';

import { useState } from 'react';

import { formatPhoneNumber } from '@/utils/formatters';
import { LenderAdminEditor, type LenderAdminEditorProps } from '@/components/people/lender-admin-editor';

interface LenderOverviewCardProps {
  lender: LenderAdminEditorProps['lender'];
  isAdmin: boolean;
}

export function LenderOverviewCard({ lender, isAdmin }: LenderOverviewCardProps) {
  const [showEditor, setShowEditor] = useState(false);

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{lender.name}</h1>
          <div className="mt-2 space-y-1 text-sm text-slate-600">
            <p>
              Email{' '}
              <a href={`mailto:${lender.email}`} className="text-brand hover:underline">
                {lender.email}
              </a>
            </p>
            <p>Phone: {formatPhoneNumber(lender.phone) || '—'}</p>
            <p>NMLS ID: {lender.nmlsId || '—'}</p>
          </div>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
            onClick={() => setShowEditor((previous) => !previous)}
          >
            {showEditor ? 'Close edit' : 'Edit details'}
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase text-slate-400">Licensed States</p>
          <p className="font-medium text-slate-900">{(lender.licensedStates ?? []).join(', ') || '—'}</p>
        </div>
      </div>

      {isAdmin && showEditor && (
        <div className="mt-6 border-t border-slate-200 pt-6">
          <LenderAdminEditor lender={lender} className="space-y-4" />
        </div>
      )}
    </div>
  );
}
