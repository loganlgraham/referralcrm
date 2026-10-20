'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/cn';

interface AutoReminderToggleProps {
  referralId: string;
  autoRemindersEnabled: boolean;
  viewerRole: string;
}

export function AutoReminderToggle({
  referralId,
  autoRemindersEnabled: initialEnabled,
  viewerRole,
}: AutoReminderToggleProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for admins
  if (viewerRole !== 'admin') {
    return null;
  }

  const handleToggle = async (newEnabled: boolean) => {
    setIsUpdating(true);
    setError(null);

    try {
      const response = await fetch(`/api/referrals/${referralId}/auto-reminders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update setting');
      }

      setEnabled(newEnabled);
      // Refresh the page to update the "Next scheduled send" display
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
      // Revert on error
      setEnabled(enabled);
    } finally {
      setIsUpdating(false);
    }
  };

  const statusLabel = isUpdating ? 'Updating...' : enabled ? 'Enabled' : 'Disabled';

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Automated update reminders</p>
          <p className="text-xs text-foreground-muted">
            Emails on day 1, 3, 7, and 14, then every 2 weeks after the agent is assigned.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Automated update reminders"
            disabled={isUpdating}
            onClick={() => handleToggle(!enabled)}
            className={cn(
              'relative h-5 w-9 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50',
              enabled ? 'bg-primary' : 'bg-border-strong'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition',
                enabled && 'translate-x-4'
              )}
            />
          </button>
          <span className="text-xs font-medium text-foreground-muted">{statusLabel}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-danger-soft border border-danger/30 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
