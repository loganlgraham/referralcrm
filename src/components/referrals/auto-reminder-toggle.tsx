'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
      // Revert on error
      setEnabled(enabled);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-full bg-amber-100 p-2 text-amber-700">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Automated update reminders</p>
            <p className="text-xs text-slate-600">
              Sends periodic emails to agents requesting updates (Day 1, 3, 7, 14, then every 2 weeks from agent assignment)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => handleToggle(event.target.checked)}
              disabled={isUpdating}
              className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
            />
            {isUpdating ? 'Updating...' : enabled ? 'Enabled' : 'Disabled'}
          </label>
        </div>
      </div>
      
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
