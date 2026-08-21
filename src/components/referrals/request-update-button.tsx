'use client';

import { useState, useMemo } from 'react';
import { Mail, Clock, CheckCircle2, Send, Calendar } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import type { Contact } from '@/components/referrals/contact-assignment';
import { getNextAutoUpdateSendAt } from '@/utils/auto-update-schedule';
import { formatInTimeZone } from 'date-fns-tz';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

interface RequestUpdateButtonProps {
  referralId: string;
  assignedAgent?: Contact | null;
  buySideAgent?: Contact | null;
  sellSideAgent?: Contact | null;
  lastAutoReminderSentAt?: Date | null;
  lastManualReminderSentAt?: Date | null;
  autoRemindersEnabled?: boolean;
  status?: string;
  lastPairedAt?: Date | null;
  audit?: Array<{
    actorRole: string;
    field: string;
    timestamp: Date;
  }>;
  notes?: Array<{
    authorRole: string;
    createdAt: Date;
  }>;
  viewerRole: string;
}

export function RequestUpdateButton({
  referralId,
  assignedAgent,
  buySideAgent,
  sellSideAgent,
  lastAutoReminderSentAt,
  lastManualReminderSentAt,
  autoRemindersEnabled = false,
  status = 'New Lead',
  lastPairedAt,
  audit = [],
  notes = [],
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

  // Calculate last sent timestamp and agent response
  const statusInfo = useMemo(() => {
    const lastAutoTime = lastAutoReminderSentAt ? new Date(lastAutoReminderSentAt).getTime() : 0;
    const lastManualTime = lastManualReminderSentAt ? new Date(lastManualReminderSentAt).getTime() : 0;
    const lastSentTime = Math.max(lastAutoTime, lastManualTime);

    if (lastSentTime === 0) {
      return {
        lastSent: null,
        agentResponded: false,
        responseDate: null,
      };
    }

    const lastSentDate = new Date(lastSentTime);

    // Check for agent actions after last sent
    const agentActionsAfter = audit.filter(
      (entry) =>
        entry.actorRole === 'agent' &&
        new Date(entry.timestamp).getTime() > lastSentTime &&
        ['status', 'propertyAddress', 'stageOnTransfer'].includes(entry.field)
    );

    const notesAfter = notes.filter(
      (note) =>
        note.authorRole === 'agent' &&
        new Date(note.createdAt).getTime() > lastSentTime
    );

    const hasResponse = agentActionsAfter.length > 0 || notesAfter.length > 0;
    let responseDate: Date | null = null;

    if (hasResponse) {
      const actionTimes = agentActionsAfter.map((a) => new Date(a.timestamp).getTime());
      const noteTimes = notesAfter.map((n) => new Date(n.createdAt).getTime());
      const allTimes = [...actionTimes, ...noteTimes];
      responseDate = new Date(Math.max(...allTimes));
    }

    return {
      lastSent: lastSentDate,
      agentResponded: hasResponse,
      responseDate,
    };
  }, [lastAutoReminderSentAt, lastManualReminderSentAt, audit, notes]);

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
    <div className="space-y-2">
      <Button
        type="button"
        onClick={handleOpenModal}
        disabled={agents.length === 0}
        leadingIcon={<Mail className="h-4 w-4" />}
      >
        Request update from agent
      </Button>

      {/* Status Display */}
      {agents.length > 0 && (
        <div className="text-xs text-foreground-muted">
          {statusInfo.lastSent ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-foreground-subtle" />
                <span>
                  Last sent: {formatDate(statusInfo.lastSent)} ({daysSince(statusInfo.lastSent)})
                </span>
              </div>
              {statusInfo.agentResponded && statusInfo.responseDate ? (
                <div className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Agent updated on {formatDate(statusInfo.responseDate)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-warning">
                  <Clock className="h-3.5 w-3.5" />
                  <span>No action yet</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-foreground-subtle">
              <Mail className="h-3.5 w-3.5" />
              <span>Never sent</span>
            </div>
          )}
          
          {/* Next Scheduled Send */}
          {nextSendInfo.nextAt ? (
            <div
              className={`flex items-center gap-1.5 mt-2 ${nextSendInfo.nextAt.getTime() < Date.now() ? 'text-warning' : 'text-info'}`}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>
                {nextSendInfo.nextAt.getTime() < Date.now()
                  ? `Overdue: ${formatDate(nextSendInfo.nextAt)} (${daysSince(nextSendInfo.nextAt)})`
                  : `Next scheduled: ${formatDate(nextSendInfo.nextAt)} (${daysSince(nextSendInfo.nextAt)})`}
              </span>
            </div>
          ) : nextSendInfo.reason ? (
            <div className="flex items-center gap-1.5 text-foreground-subtle mt-2">
              <Calendar className="h-3.5 w-3.5" />
              <span>{nextSendInfo.reason}</span>
            </div>
          ) : null}
        </div>
      )}

      {agents.length === 0 && (
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
