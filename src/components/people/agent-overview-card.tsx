'use client';

import { useMemo, useState } from 'react';

import { AgentAdminEditor, type AgentAdminEditorProps } from '@/components/people/agent-admin-editor';
import { SendWelcomeEmailButton } from '@/components/people/send-welcome-email-button';
import { formatPhoneNumber } from '@/utils/formatters';

interface AgentOverviewCardProps {
  agent: AgentAdminEditorProps['agent'] & {
    signupStatus?: {
      hasSignedUp: boolean;
      signedUpAfterWelcomeEmail: boolean | null;
      welcomeEmailSentAt: Date | null;
    } | null;
  };
  isAdmin: boolean;
}

export function AgentOverviewCard({ agent, isAdmin }: AgentOverviewCardProps) {
  const [showEditor, setShowEditor] = useState(false);

  const coverageLabels = useMemo(() => {
    if (Array.isArray(agent.coverageLocations) && agent.coverageLocations.length > 0) {
      return agent.coverageLocations.map((location) => location.label);
    }

    if (Array.isArray(agent.coverageAreas)) {
      return agent.coverageAreas;
    }

    return [];
  }, [agent.coverageAreas, agent.coverageLocations]);

  const signupStatusDisplay = useMemo(() => {
    if (!isAdmin || !agent.signupStatus) return null;
    const { hasSignedUp, signedUpAfterWelcomeEmail, welcomeEmailSentAt } = agent.signupStatus;
    if (hasSignedUp) {
      if (signedUpAfterWelcomeEmail === true) {
        return { text: 'Signed up after welcome email', color: 'bg-emerald-50 text-emerald-700' };
      } else if (signedUpAfterWelcomeEmail === false) {
        return { text: 'Signed up before welcome email', color: 'bg-amber-50 text-amber-700' };
      } else {
        return { text: 'Signed up', color: 'bg-blue-50 text-blue-700' };
      }
    } else if (welcomeEmailSentAt) {
      return { text: 'Welcome email sent, not signed up', color: 'bg-amber-50 text-amber-700' };
    } else {
      return { text: 'No welcome email sent', color: 'bg-slate-50 text-slate-600' };
    }
  }, [isAdmin, agent.signupStatus]);

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{agent.name}</h1>
          <div className="mt-2 space-y-1 text-sm text-slate-600">
            <p>
              Email{' '}
              <a href={`mailto:${agent.email}`} className="text-brand hover:underline">
                {agent.email}
              </a>
            </p>
            <p>Phone: {formatPhoneNumber(agent.phone) || '—'}</p>
            <p>License: {agent.licenseNumber || '—'}</p>
            <p>Brokerage: {agent.brokerage || '—'}</p>
            {isAdmin && agent.source && (
              <p>Source: {agent.source}</p>
            )}
            <p>
              AHA Classification:{' '}
              {agent.ahaDesignation === 'AHA'
                ? 'AHA'
                : agent.ahaDesignation === 'AHA_OOS'
                ? 'AHA OOS'
                : agent.ahaDesignation === 'AGIT'
                ? 'AGIT'
                : '—'}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <SendWelcomeEmailButton
                endpoint={`/api/agents/${agent._id}/welcome-email`}
                recipientEmail={agent.email}
                recipientName={agent.name}
              />
              <button
                type="button"
                className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
                onClick={() => setShowEditor((previous) => !previous)}
              >
                {showEditor ? 'Close edit' : 'Edit details'}
              </button>
            </div>
            {signupStatusDisplay && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${signupStatusDisplay.color}`}>
                {signupStatusDisplay.text}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase text-slate-400">States Licensed</p>
          <p className="font-medium text-slate-900">{agent.statesLicensed?.join(', ') || '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-400">Areas Covered</p>
          <p className="font-medium text-slate-900">{coverageLabels.slice(0, 10).join(', ') || '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-400">Specialties</p>
          <p className="font-medium text-slate-900">
            {Array.isArray(agent.specialties) && agent.specialties.length > 0
              ? agent.specialties.join(', ')
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-400">Languages</p>
          <p className="font-medium text-slate-900">
            {Array.isArray(agent.languages) && agent.languages.length > 0
              ? agent.languages.join(', ')
              : '—'}
          </p>
        </div>
        {agent.npsScore !== null && agent.npsScore !== undefined && (
          <div>
            <p className="text-xs uppercase text-slate-400">NPS Score</p>
            <p className="font-medium text-slate-900">
              {typeof agent.npsScore === 'number' ? agent.npsScore.toFixed(1) : '—'}
            </p>
          </div>
        )}
      </div>

      {isAdmin && showEditor && (
        <div className="mt-6 border-t border-slate-200 pt-6">
          <AgentAdminEditor
            agent={agent}
            variant="embedded"
            className="space-y-4"
            onSaved={() => setShowEditor(false)}
          />
        </div>
      )}
    </div>
  );
}

