'use client';

import { useState, useMemo } from 'react';
import { Mail, Clock, CheckCircle2, Send, Calendar } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import type { Contact } from '@/components/referrals/contact-assignment';
import { getNextAutoUpdateSendAt } from '@/utils/auto-update-schedule';
import { formatInTimeZone } from 'date-fns-tz';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';
import {
  getLastUpdateRequestSentAt,
  hasPendingUpdateRequest,
} from '@/utils/update-request-pending';

interface RequestUpdateButtonProps {
  referralId: string;
  assignedAgent?: Contact | null;
  buySideAgent?: Contact | null;
  sellSideAgent?: Contact | null;
  lastAutoReminderSentAt?: string | Date | null;
  lastManualReminderSentAt?: string | Date | null;
  lastUpdateRequestResponseNotifiedAt?: string | Date | null;
  autoRemindersEnabled?: boolean;
  status?: string;
  lastPairedAt?: Date | null;
  viewerRole: string;
}

export function RequestUpdateButton({
  referralId,
  assignedAgent,
  buySideAgent,
  sellSideAgent,
  lastAutoReminderSentAt,
  lastManualReminderSentAt,
  lastUpdateRequestResponseNotifiedAt,
  autoRemindersEnabled = false,
  status = 'New Lead',
  lastPairedAt,
  viewerRole,
}: RequestUpdateButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Only show for admins
  if (viewerRole !== 'admin') {
    return null;
  }

  // Get unique agents
  const agents = useMemo(() => {
    const agentMap = new Map<string, Contact>();

    if (assignedAgent?.id) {
      agentMap.set(assignedAgent.id, assignedAgent);
    }
    if (buySideAgent?.id) {
      agentMap.set(buySideAgent.id, buySideAgent);
    }
    if (sellSideAgent?.id) {
      agentMap.set(sellSideAgent.id, sellSideAgent);
    }

    return Array.from(agentMap.entries())
      .map(([id, contact]) => ({ ...contact, id }))
      .filter((contact): contact is Contact & { id: string } => Boolean(contact.id));
  }, [assignedAgent, buySideAgent, sellSideAgent]);

  const statusInfo = useMemo(() => {
    const pendingInput = {
      lastAutoReminderSentAt,
      lastManualReminderSentAt,
      lastUpdateRequestResponseNotifiedAt,
    };
    const lastSent = getLastUpdateRequestSentAt(pendingInput);
    if (!lastSent) {
      return {
        lastSent: null,
        agentResponded: false,
        responseDate: null,
      };
    }

    const pending = hasPendingUpdateRequest(pendingInput);
    const responseTime = lastUpdateRequestResponseNotifiedAt
      ? new Date(lastUpdateRequestResponseNotifiedAt)
      : null;
    const responseDate =
      !pending && responseTime && !Number.isNaN(responseTime.getTime()) ? responseTime : null;

    return {
      lastSent,
      agentResponded: !pending,
      responseDate,
    };
  }, [lastAutoReminderSentAt, lastManualReminderSentAt, lastUpdateRequestResponseNotifiedAt]);

  // Calculate next scheduled send
  const nextSendInfo = useMemo(() => {
    return getNextAutoUpdateSendAt({
      pairedAt: lastPairedAt,
      lastAutoSentAt: lastAutoReminderSentAt,
      autoRemindersEnabled,
      status,
    });
  }, [lastPairedAt, lastAutoReminderSentAt, autoRemindersEnabled, status]);

  const handleToggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const handleSubmit = async () => {
    if (selectedAgentIds.length === 0) {
      setError('Please select at least one agent');
      return;
    }

    setIsSending(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/referrals/${referralId}/request-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: selectedAgentIds, isAutomated: false }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send emails');
      }

      setSuccessMessage(`Update requests sent to ${data.sent.length} agent(s)`);
      setIsModalOpen(false);
      setSelectedAgentIds([]);
      
      // Refresh the page to show updated status
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send emails');
    } finally {
      setIsSending(false);
    }
  };

  const handleOpenModal = () => {
    setIsModalOpen(true);
    setError(null);
    setSuccessMessage(null);
    // Pre-select all agents by default
    setSelectedAgentIds(agents.map((a) => a.id));
  };

  const formatDate = (date: Date) => {
    try {
      return formatInTimeZone(date, SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
    } catch {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
    }
  };

  const daysSince = (date: Date) => {
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days > 0) return `${days} days ago`;
    // Future date
    const futureDays = Math.abs(days);
    if (futureDays === 1) return 'tomorrow';
    return `in ${futureDays} days`;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-foreground">Agent updates</p>
          <p className="text-xs text-foreground-subtle">Ask the assigned agent for a status note.</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleOpenModal}
          disabled={agents.length === 0}
          leadingIcon={<Mail className="h-3.5 w-3.5" />}
        >
          Request update
        </Button>
      </div>

      {agents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-subtle">
          {statusInfo.lastSent ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                Last sent: {formatDate(statusInfo.lastSent)} ({daysSince(statusInfo.lastSent)})
              </span>
              {statusInfo.agentResponded && statusInfo.responseDate ? (
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Agent updated on {formatDate(statusInfo.responseDate)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  No action yet
                </span>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" aria-hidden />
              Never sent
            </span>
          )}
          {nextSendInfo.nextAt ? (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              {nextSendInfo.nextAt.getTime() < Date.now()
                ? `Overdue: ${formatDate(nextSendInfo.nextAt)} (${daysSince(nextSendInfo.nextAt)})`
                : `Next scheduled: ${formatDate(nextSendInfo.nextAt)} (${daysSince(nextSendInfo.nextAt)})`}
            </span>
          ) : nextSendInfo.reason ? (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              {nextSendInfo.reason}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-foreground-subtle">No agents assigned to this referral</p>
      )}

      {/* Success message outside modal */}
      {successMessage && !isModalOpen && (
        <div className="rounded-lg bg-success-soft border border-success/30 px-3 py-2 text-xs text-success">
          {successMessage}
        </div>
      )}

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Request Update from Agent(s)"
        size="sm"
      >
        <div className="p-6 space-y-4">
          <p className="text-sm text-foreground-muted">
            Select which agent(s) should receive an email requesting them to update the referral status and add notes.
          </p>

          {error && (
            <div className="rounded-lg bg-danger-soft border border-danger/30 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="space-y-2">
            {agents.map((agent) => (
              <label
                key={agent.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-surface-muted transition"
              >
                <input
                  type="checkbox"
                  checked={selectedAgentIds.includes(agent.id)}
                  onChange={() => handleToggleAgent(agent.id)}
                  className="h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm text-foreground">{agent.name ?? 'Agent'}</div>
                  <div className="text-xs text-foreground-subtle">{agent.email ?? 'No email on file'}</div>
                </div>
              </label>
            ))}
          </div>

          <div className="flex gap-3 pt-4 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setIsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleSubmit}
              disabled={selectedAgentIds.length === 0}
              loading={isSending}
              leadingIcon={<Send className="h-4 w-4" />}
            >
              {isSending ? 'Sending...' : `Send email${selectedAgentIds.length > 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
