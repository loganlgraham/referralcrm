'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { formatInTimeZone } from 'date-fns-tz';
import { useState } from 'react';
import { toast } from 'sonner';

import type { AgentActivityEntry } from '@/lib/server/agent-activity';
import { fetcher } from '@/utils/fetcher';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

const ACTION_LABELS: Record<AgentActivityEntry['action'], string> = {
  login: 'Login',
  call: 'Call',
  sms: 'Text message',
  email: 'Email',
  note: 'Note',
  status: 'Status',
  update: 'Update',
};

export function AgentActivityCard({ agentId }: { agentId: string }) {
  const endpoint = `/api/agents/${agentId}/activity`;
  const { data, error, isLoading } = useSWR<AgentActivityEntry[]>(endpoint, fetcher);
  const activities = Array.isArray(data) ? data : [];
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadFullLog = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const response = await fetch(`${endpoint}?format=csv`);
      if (!response.ok) {
        throw new Error('Unable to download the activity log');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? 'agent-activity-log.csv';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      toast.error(
        downloadError instanceof Error
          ? downloadError.message
          : 'Unable to download the activity log'
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <section className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-eyebrow text-foreground-muted">Agent activity</h2>
          <p className="mt-1 text-xs text-foreground-subtle">
            The five most recent actions completed by this agent.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void downloadFullLog()}
          loading={isDownloading}
        >
          {isDownloading ? 'Preparing download…' : 'Download full activity log (.csv)'}
        </Button>
      </div>

      <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
        {isLoading ? (
          <p className="py-4 text-sm text-foreground-subtle">Loading activity…</p>
        ) : error ? (
          <p className="py-4 text-sm text-danger">We couldn’t load this agent’s activity.</p>
        ) : activities.length === 0 ? (
          <EmptyState
            compact
            title="No agent activity yet"
            description="Calls, emails and status changes will appear here."
          />
        ) : (
          activities.map((activity) => (
            <article
              key={activity.id}
              className="rounded-card border border-border bg-surface-muted/60 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-eyebrow text-foreground-subtle">
                  {ACTION_LABELS[activity.action]}
                </span>
                <time className="text-numeric text-xs text-foreground-subtle">
                  {formatInTimeZone(
                    new Date(activity.createdAt),
                    SLA_TIME_ZONE,
                    "MMM d, yyyy 'at' h:mm a 'MT'"
                  )}
                </time>
              </div>
              <p className="mt-1 text-sm text-foreground-muted">{activity.content}</p>
              {activity.referral ? (
                <Link
                  href={`/referrals/${activity.referral.id}`}
                  className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                >
                  {activity.referral.borrowerName || activity.referral.loanFileNumber || 'View referral'}
                </Link>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
