'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { AgentAdminEditor, type AgentAdminEditorProps } from '@/components/people/agent-admin-editor';
import { SendWelcomeEmailButton } from '@/components/people/send-welcome-email-button';
import { promptInactiveMetricsChoice } from '@/components/people/inactive-metrics-toast';
import { CopyButton } from '@/components/common/copy-button';
import { formatDateMST, formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';

interface AgentOverviewCardProps {
  agent: AgentAdminEditorProps['agent'] & {
    includeInMetrics?: boolean;
    lastActivityAt?: string | null;
    lastLoggedOnAt?: string | null;
    signupStatus?: {
      hasSignedUp: boolean;
      signedUpAfterWelcomeEmail: boolean | null;
      welcomeEmailSentAt: Date | null;
    } | null;
  };
  isAdmin: boolean;
}

export function AgentOverviewCard({ agent, isAdmin }: AgentOverviewCardProps) {
  const router = useRouter();
  const [showEditor, setShowEditor] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  const patchStatus = async (active: boolean, includeInMetrics: boolean) => {
    if (togglingActive) return;
    setTogglingActive(true);
    try {
      const response = await fetch(`/api/agents/${agent._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, includeInMetrics }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? 'Unable to update agent status');
      }
      if (active) {
        toast.success('Agent marked active');
      } else {
        toast.success(
          includeInMetrics
            ? 'Agent marked inactive (kept in leaderboards)'
            : 'Agent marked inactive (excluded from leaderboards)'
        );
      }
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update agent status');
    } finally {
      setTogglingActive(false);
    }
  };

  const handleToggleActive = () => {
    if (togglingActive) return;
    if (agent.active) {
      promptInactiveMetricsChoice({
        label: 'agent',
        onChoose: (includeInMetrics) => {
          void patchStatus(false, includeInMetrics);
        },
      });
    } else {
      void patchStatus(true, true);
    }
  };

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
        return { text: 'Signed up after welcome email', tone: 'success' as const };
      } else if (signedUpAfterWelcomeEmail === false) {
        return { text: 'Signed up before welcome email', tone: 'warning' as const };
      } else {
        return { text: 'Signed up', tone: 'info' as const };
      }
    } else if (welcomeEmailSentAt) {
      return { text: 'Welcome email sent, not signed up', tone: 'warning' as const };
    } else {
      return { text: 'No welcome email sent', tone: 'muted' as const };
    }
  }, [isAdmin, agent.signupStatus]);

  const pillToneClasses: Record<'success' | 'warning' | 'info' | 'muted', { container: string; dot: string }> = {
    success: {
      container: 'border-success/30 bg-success-soft/80 text-success',
      dot: 'bg-success',
    },
    warning: {
      container: 'border-warning/30 bg-warning-soft/80 text-warning',
      dot: 'bg-warning',
    },
    info: {
      container: 'border-info/30 bg-info-soft/80 text-info',
      dot: 'bg-info',
    },
    muted: {
      container: 'border-border bg-surface-muted/80 text-foreground-muted',
      dot: 'bg-foreground-subtle',
    },
  };
  const pillBaseClass =
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm';

  return (
    <div className="rounded-md bg-surface-raised p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold text-foreground">{agent.name}</h1>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                agent.active ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
              }`}
            >
              {agent.active ? 'Active' : 'Inactive'}
            </span>
            {!agent.active && agent.includeInMetrics === false && (
              <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                Excluded from leaderboards
              </span>
            )}
            <CopyButton value={agent.name} label="Copy name" />
          </div>
          <div className="mt-2 space-y-1 text-sm text-foreground-muted">
            <p className="flex items-center gap-1">
              Email{' '}
              <a
                href={buildGmailComposeUrl(agent.email)}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {agent.email}
              </a>
              <CopyButton value={agent.email} label="Copy email" />
            </p>
            <p className="flex items-center gap-1">
              Phone:{' '}
              {agent.phone ? (
                <a
                  href={`tel:${agent.phone.replace(/[^0-9+]/g, '')}`}
                  className="text-primary hover:underline"
                >
                  {formatPhoneNumber(agent.phone)}
                </a>
              ) : (
                '—'
              )}
              {agent.phone && <CopyButton value={agent.phone} label="Copy phone" />}
            </p>
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
                onClick={handleToggleActive}
                disabled={togglingActive}
                className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70 ${
                  agent.active
                    ? 'border border-danger/30 bg-danger-soft text-danger hover:bg-danger-soft'
                    : 'border border-success/30 bg-success-soft text-success hover:bg-success-soft'
                }`}
                title={agent.active ? 'Mark this agent inactive so admins know not to use them' : 'Mark this agent active'}
              >
                {togglingActive
                  ? 'Saving…'
                  : agent.active
                  ? 'Mark inactive'
                  : 'Mark active'}
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover"
                onClick={() => setShowEditor((previous) => !previous)}
              >
                {showEditor ? 'Close edit' : 'Edit details'}
              </button>
            </div>
            {signupStatusDisplay && (
              <div className="flex flex-col items-end gap-1.5">
                <span
                  className={`${pillBaseClass} ${pillToneClasses[signupStatusDisplay.tone].container}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${pillToneClasses[signupStatusDisplay.tone].dot}`} />
                  {signupStatusDisplay.text}
                </span>
                <div className="w-fit max-w-[260px] rounded-xl border border-border bg-surface-muted/50 px-3 py-2 text-right">
                  <p className="text-[11px] font-medium text-foreground-muted">
                    Last activity:{' '}
                    <span className="font-semibold text-foreground">
                      {agent.lastActivityAt ? formatDateMST(agent.lastActivityAt) : 'none yet'}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-foreground-muted">
                    Logged on:{' '}
                    <span className="font-semibold text-foreground">
                      {agent.lastLoggedOnAt ? formatDateMST(agent.lastLoggedOnAt) : 'none yet'}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 text-sm text-foreground-muted sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase text-foreground-subtle">States Licensed</p>
          <p className="font-medium text-foreground">{agent.statesLicensed?.join(', ') || '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-foreground-subtle">Areas Covered</p>
          <p className="font-medium text-foreground">{coverageLabels.slice(0, 10).join(', ') || '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-foreground-subtle">Specialties</p>
          <p className="font-medium text-foreground">
            {Array.isArray(agent.specialties) && agent.specialties.length > 0
              ? agent.specialties.join(', ')
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-foreground-subtle">Languages</p>
          <p className="font-medium text-foreground">
            {Array.isArray(agent.languages) && agent.languages.length > 0
              ? agent.languages.join(', ')
              : '—'}
          </p>
        </div>
        {agent.npsScore !== null && agent.npsScore !== undefined && (
          <div>
            <p className="text-xs uppercase text-foreground-subtle">NPS Score</p>
            <p className="font-medium text-foreground">
              {typeof agent.npsScore === 'number' ? agent.npsScore.toFixed(1) : '—'}
            </p>
          </div>
        )}
      </div>

      {isAdmin && showEditor && (
        <div className="mt-6 border-t border-border pt-6">
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

