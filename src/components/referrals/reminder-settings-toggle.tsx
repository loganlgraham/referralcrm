'use client';

import { useMemo } from 'react';
import { Mail, RotateCcw } from 'lucide-react';

import { useFollowUpTaskContext, type ReminderFrequency } from '@/components/referrals/follow-up-task-provider';

interface ReminderSettingsToggleProps {
  referralId?: string;
  title?: string;
  helperText?: string;
}

export function ReminderSettingsToggle({ referralId, title, helperText }: ReminderSettingsToggleProps) {
  const {
    globalReminderSettings,
    getReminderSettings,
    updateReminderSettings,
    clearReminderOverride,
    hasReminderOverride,
  } = useFollowUpTaskContext();

  const reminderSettings = getReminderSettings(referralId);
  const isOverride = referralId ? hasReminderOverride(referralId) : false;

  const description = useMemo(() => {
    if (!reminderSettings.enabled) {
      return referralId
        ? 'Uses the global reminder preference unless you override it here.'
        : 'Enable reminder emails to receive summaries of outstanding tasks.';
    }
    return `Reminder emails will be delivered on a ${reminderSettings.frequency} cadence via Resend.`;
  }, [referralId, reminderSettings]);

  const handleFrequencyChange = (value: ReminderFrequency) => {
    updateReminderSettings({ ...reminderSettings, frequency: value }, referralId);
  };

  const handleToggle = (enabled: boolean) => {
    updateReminderSettings({ ...reminderSettings, enabled }, referralId);
  };

  const handleReset = () => {
    if (referralId) {
      clearReminderOverride(referralId);
    }
  };

  const heading = title ?? (referralId ? 'Referral reminder preference' : 'Task reminder emails');
  const supportingText = helperText ?? description;

  const isInherited = referralId && !isOverride;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-1 rounded-full bg-brand/10 p-2 text-brand">
          <Mail className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{heading}</p>
          <p className="text-xs text-slate-600">{supportingText}</p>
          {isInherited ? (
            <p className="text-[11px] font-semibold text-slate-500">
              Inherits global setting ({globalReminderSettings.enabled ? globalReminderSettings.frequency : 'disabled'}).
            </p>
          ) : null}
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
        {isOverride ? (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to global
          </button>
        ) : null}
      </div>
    </div>
  );
}
