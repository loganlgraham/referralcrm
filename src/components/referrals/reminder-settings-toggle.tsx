'use client';

import { useMemo } from 'react';
import { Mail } from 'lucide-react';

import { useFollowUpTaskContext, type ReminderFrequency } from '@/components/referrals/follow-up-task-provider';

export function ReminderSettingsToggle() {
  const { reminderSettings, updateReminderSettings } = useFollowUpTaskContext();

  const description = useMemo(() => {
    if (!reminderSettings.enabled) {
      return 'Enable reminder emails to receive summaries of outstanding tasks.';
    }
    return `Reminder emails will be delivered on a ${reminderSettings.frequency} cadence via Resend.`;
  }, [reminderSettings]);

  const handleFrequencyChange = (value: ReminderFrequency) => {
    updateReminderSettings({ ...reminderSettings, frequency: value });
  };

  const handleToggle = (enabled: boolean) => {
    updateReminderSettings({ ...reminderSettings, enabled });
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-1 rounded-full bg-brand/10 p-2 text-brand">
          <Mail className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Task reminder emails</p>
          <p className="text-xs text-slate-600">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={reminderSettings.enabled}
            onChange={(event) => handleToggle(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
          />
          Enable emails
        </label>
        <select
          value={reminderSettings.frequency}
          onChange={(event) => handleFrequencyChange(event.target.value as ReminderFrequency)}
          disabled={!reminderSettings.enabled}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="daily">Daily summary</option>
          <option value="weekly">Weekly summary</option>
        </select>
      </div>
    </div>
  );
}
