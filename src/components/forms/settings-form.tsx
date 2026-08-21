'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldGrid, FieldGroup, FieldLabel, selectFieldClasses } from '@/components/ui/field-group';
import { Input, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/cn';

const DASHBOARD_METRICS = [
  { id: 'summary', label: 'Executive summary (totals, close rate, revenue)' },
  { id: 'revenue', label: 'Revenue trend by period' },
  { id: 'deals', label: 'Deals closed, pipeline, and under contract' },
  { id: 'funnel', label: 'Conversion funnel by stage' },
  { id: 'attachRate', label: 'AFC and agent attach rates' },
  { id: 'preApprovals', label: 'Mortgage consultant transfers' },
  { id: 'geography', label: 'Revenue by state' },
  { id: 'network', label: 'Network breakdown (AHA / AHA OOS / AFC / Unpaired)' },
  { id: 'termination', label: 'Terminated deals & lost referral fees' }
] as const;

type DashboardMetricId = (typeof DASHBOARD_METRICS)[number]['id'];

type Cadence = 'one-time' | 'daily' | 'weekly' | 'monthly';
type NetworkFilter = 'ALL' | 'AHA' | 'AHA_OOS';

type ScheduledReportSummary = {
  id: string;
  name: string;
  reportName: string;
  reportTimeframe: string;
  metrics: string[];
  network: NetworkFilter;
  recipients: string[];
  cadence: 'daily' | 'weekly' | 'monthly';
  attachCsv: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
};

type ReportPresetConfig = {
  reportName: string;
  reportTimeframe: string;
  customStartDate: string;
  customEndDate: string;
  metrics: DashboardMetricId[];
  recipients: string;
  network: NetworkFilter;
  attachCsv: boolean;
};

type ExportReport = 'referrals' | 'agents' | 'mcs' | 'deals';

const EXPORT_DEFINITIONS: Record<ExportReport, { label: string; helper: string }> = {
  referrals: {
    label: 'Referrals',
    helper: 'All inbound and assigned referrals with borrower, source, and status.'
  },
  agents: {
    label: 'Agents',
    helper: 'Roster with market centers, production, and key contact info.'
  },
  mcs: {
    label: 'Mortgage consultants',
    helper: 'Lender partners with referral totals and pre-approval conversions.'
  },
  deals: {
    label: 'Deals',
    helper: 'Closed and active deals with referral fee details.'
  }
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRecipientList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,;\n]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );
}

function formatRunAt(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      timeZone: 'America/Denver',
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return value;
  }
}

function describeCadence(cadence: 'daily' | 'weekly' | 'monthly'): string {
  switch (cadence) {
    case 'daily':
      return 'Daily, 7am MT';
    case 'weekly':
      return 'Weekly (Mondays, 7am MT)';
    case 'monthly':
      return 'Monthly (1st, 7am MT)';
  }
}

export function SettingsForm() {
  const [tier1, setTier1] = useState(25);
  const [tier2, setTier2] = useState(35);
  const [loading, setLoading] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useState<DashboardMetricId[]>(() =>
    DASHBOARD_METRICS.map((metric) => metric.id)
  );
  const [reportName, setReportName] = useState('Performance dashboard export');
  const [reportTimeframe, setReportTimeframe] = useState('This month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [recipientsInput, setRecipientsInput] = useState('ops@referralcrm.com');
  const [network, setNetwork] = useState<NetworkFilter>('ALL');
  const [attachCsv, setAttachCsv] = useState(false);
  const [cadence, setCadence] = useState<Cadence>('one-time');
  const [scheduleName, setScheduleName] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [exporting, setExporting] = useState<ExportReport | null>(null);
  const [reportPresets, setReportPresets] = useState<{ name: string; config: ReportPresetConfig }[]>([]);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [schedules, setSchedules] = useState<ScheduledReportSummary[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);

  const recipients = useMemo(() => parseRecipientList(recipientsInput), [recipientsInput]);
  const invalidRecipients = useMemo(
    () => recipients.filter((email) => !EMAIL_REGEX.test(email)),
    [recipients]
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('dashboard-report-presets');
      setReportPresets(raw ? (JSON.parse(raw) as { name: string; config: ReportPresetConfig }[]) : []);
    } catch {
      setReportPresets([]);
    }
  }, []);

  const refreshSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    try {
      const response = await fetch('/api/admin/scheduled-reports');
      if (!response.ok) {
        throw new Error('Failed to load schedules');
      }
      const data = (await response.json()) as { schedules: ScheduledReportSummary[] };
      setSchedules(data.schedules ?? []);
    } catch (err) {
      console.error(err);
      setSchedules([]);
    } finally {
      setSchedulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSchedules();
  }, [refreshSchedules]);

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      toast.error('Enter a preset name.');
      return;
    }
    const config: ReportPresetConfig = {
      reportName,
      reportTimeframe,
      customStartDate,
      customEndDate,
      metrics: selectedMetrics,
      recipients: recipientsInput,
      network,
      attachCsv
    };
    const next = reportPresets.some((p) => p.name === name)
      ? reportPresets.map((p) => (p.name === name ? { name, config } : p))
      : [...reportPresets, { name, config }];
    setReportPresets(next);
    window.localStorage.setItem('dashboard-report-presets', JSON.stringify(next));
    setPresetName('');
    toast.success(`Preset "${name}" saved.`);
  };

  const loadPreset = (name: string) => {
    const preset = reportPresets.find((p) => p.name === name);
    if (!preset) return;
    setReportName(preset.config.reportName);
    setReportTimeframe(preset.config.reportTimeframe);
    setCustomStartDate(preset.config.customStartDate);
    setCustomEndDate(preset.config.customEndDate);
    setSelectedMetrics(preset.config.metrics);
    setRecipientsInput(preset.config.recipients);
    setNetwork(preset.config.network ?? 'ALL');
    setAttachCsv(Boolean(preset.config.attachCsv));
    setSelectedPresetId(name);
    toast.success(`Loaded preset "${name}".`);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    toast.success('Settings saved');
    setLoading(false);
  };

  const toggleMetric = (metric: DashboardMetricId) => {
    setSelectedMetrics((prev) =>
      prev.includes(metric) ? prev.filter((item) => item !== metric) : [...prev, metric]
    );
  };

  const allMetricsSelected = useMemo(
    () => selectedMetrics.length === DASHBOARD_METRICS.length,
    [selectedMetrics.length]
  );

  const handleSelectAll = () => {
    setSelectedMetrics((prev) =>
      prev.length === DASHBOARD_METRICS.length
        ? []
        : DASHBOARD_METRICS.map((metric) => metric.id)
    );
  };

  const validateForSubmission = (): boolean => {
    if (!selectedMetrics.length) {
      toast.error('Select at least one dashboard metric to include.');
      return false;
    }
    if (reportTimeframe === 'Custom export window' && (!customStartDate || !customEndDate)) {
      toast.error('Select a start and end date for the custom timeframe.');
      return false;
    }
    if (recipients.length === 0) {
      toast.error('Add at least one recipient email.');
      return false;
    }
    if (invalidRecipients.length > 0) {
      toast.error(`Fix invalid email(s): ${invalidRecipients.join(', ')}`);
      return false;
    }
    return true;
  };

  const handlePrimaryAction = async () => {
    if (!validateForSubmission()) return;

    if (cadence !== 'one-time') {
      await handleSaveSchedule();
      return;
    }

    setReportLoading(true);
    try {
      const response = await fetch('/api/admin/dashboard-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportName,
          reportTimeframe,
          customStartDate,
          customEndDate,
          metrics: selectedMetrics,
          network,
          recipients,
          attachCsv
        })
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Unable to email dashboard metrics.');
      }

      const timeframeLabel =
        reportTimeframe === 'Custom export window'
          ? `${customStartDate || 'Start'} to ${customEndDate || 'End'}`
          : reportTimeframe;
      toast.success(
        `Dashboard report "${reportName}" (${timeframeLabel}) sent to ${recipients.length} recipient${
          recipients.length === 1 ? '' : 's'
        }.`
      );
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to send dashboard report.');
    } finally {
      setReportLoading(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (cadence === 'one-time') return;
    try {
      const response = await fetch('/api/admin/scheduled-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: scheduleName.trim() || `${reportName} (${cadence})`,
          reportName,
          reportTimeframe,
          customStartDate,
          customEndDate,
          metrics: selectedMetrics,
          network,
          recipients,
          cadence,
          attachCsv,
          enabled: true
        })
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Unable to save schedule.');
      }
      toast.success(`Scheduled "${scheduleName.trim() || reportName}" — ${describeCadence(cadence as 'daily' | 'weekly' | 'monthly')}.`);
      setScheduleName('');
      setCadence('one-time');
      await refreshSchedules();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save schedule.');
    }
  };

  const handleDeleteSchedule = async (id: string, name: string) => {
    if (!window.confirm(`Delete schedule "${name}"? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/admin/scheduled-reports/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Unable to delete schedule.');
      }
      toast.success(`Deleted schedule "${name}".`);
      await refreshSchedules();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to delete schedule.');
    }
  };

  const handleToggleSchedule = async (id: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/admin/scheduled-reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Unable to update schedule.');
      }
      await refreshSchedules();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update schedule.');
    }
  };

  const handleDownloadReportCsv = async () => {
    if (!validateForSubmission()) return;
    setCsvLoading(true);
    try {
      const response = await fetch('/api/admin/dashboard-report/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportName,
          reportTimeframe,
          customStartDate,
          customEndDate,
          metrics: selectedMetrics,
          network
        })
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Unable to download report.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filenameDate = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.setAttribute('download', `dashboard-report-${filenameDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Dashboard report CSV downloading.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to download report.');
    } finally {
      setCsvLoading(false);
    }
  };

  const handleDownloadCsv = async (report: ExportReport) => {
    const { label } = EXPORT_DEFINITIONS[report];
    setExporting(report);
    try {
      const params = new URLSearchParams({ report });
      const response = await fetch(`/api/admin/exports?${params.toString()}`);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Unable to download export.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${report}-report.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`${label} report is downloading.`);
    } catch (error) {
      console.error(error);
      toast.error('Unable to generate CSV export right now.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Manage referral fee policies, reports, and data exports."
        attention={false}
      />

      <form onSubmit={handleSubmit}>
        <FieldGroup
          title="Referral fee policy"
          description="Default tiers applied when a deal has no explicit referral fee override."
        >
          <FieldGrid>
            <label className="block space-y-1.5">
              <FieldLabel label="Closed price ≤ $400k" hint="% of commission" />
              <Input
                type="number"
                min="0"
                max="100"
                value={tier1}
                onChange={(event) => setTier1(Number(event.target.value))}
                className="text-numeric font-medium"
              />
            </label>
            <label className="block space-y-1.5">
              <FieldLabel label="Closed price above $400k" hint="% of commission" />
              <Input
                type="number"
                min="0"
                max="100"
                value={tier2}
                onChange={(event) => setTier2(Number(event.target.value))}
                className="text-numeric font-medium"
              />
            </label>
          </FieldGrid>
          <div className="mt-4">
            <Button type="submit" loading={loading}>
              {loading ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </FieldGroup>
      </form>

      <FieldGroup
        title="Dashboard metric reports"
        description="Email a snapshot of admin dashboard metrics to one or more recipients, or schedule recurring delivery."
        action={
          <Button variant="ghost" size="sm" onClick={handleSelectAll}>
            {allMetricsSelected ? 'Clear selection' : 'Select all metrics'}
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {DASHBOARD_METRICS.map((metric) => {
            const isChecked = selectedMetrics.includes(metric.id);
            return (
              <label
                key={metric.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                  isChecked ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-border-strong'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleMetric(metric.id)}
                  className="mt-1 h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
                />
                <span className="text-sm text-foreground-muted">{metric.label}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-4 grid gap-x-4 gap-y-3 md:grid-cols-3">
          <label className="block space-y-1.5">
            <FieldLabel label="Report name" />
            <Input
              type="text"
              value={reportName}
              onChange={(event) => setReportName(event.target.value)}
              placeholder="Performance dashboard export"
            />
          </label>
          <label className="block space-y-1.5">
            <FieldLabel label="Timeframe" />
            <select
              value={reportTimeframe}
              onChange={(event) => {
                const value = event.target.value;
                setReportTimeframe(value);
                if (value !== 'Custom export window') {
                  setCustomStartDate('');
                  setCustomEndDate('');
                }
              }}
              className={selectFieldClasses}
            >
              <option>This week</option>
              <option>Last week</option>
              <option>This month</option>
              <option>Last month</option>
              <option>Last 90 days</option>
              <option>Year to date</option>
              <option>All</option>
              <option>Custom export window</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <FieldLabel label="Network filter" />
            <select
              value={network}
              onChange={(event) => setNetwork(event.target.value as NetworkFilter)}
              className={selectFieldClasses}
            >
              <option value="ALL">All</option>
              <option value="AHA">AHA</option>
              <option value="AHA_OOS">AHA OOS</option>
            </select>
          </label>
          {reportTimeframe === 'Custom export window' && (
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:col-span-3 md:grid-cols-2">
              <label className="block space-y-1.5">
                <FieldLabel label="Start date" />
                <Input
                  type="date"
                  value={customStartDate}
                  onChange={(event) => setCustomStartDate(event.target.value)}
                  className="text-numeric"
                />
              </label>
              <label className="block space-y-1.5">
                <FieldLabel label="End date" />
                <Input
                  type="date"
                  value={customEndDate}
                  onChange={(event) => setCustomEndDate(event.target.value)}
                  className="text-numeric"
                />
              </label>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-x-4 gap-y-3 md:grid-cols-2">
          <label className="block space-y-1.5">
            <FieldLabel label="Recipients" hint="comma-separated" />
            <Textarea
              value={recipientsInput}
              onChange={(event) => setRecipientsInput(event.target.value)}
              className="h-20"
              placeholder="ops@referralcrm.com, leadership@referralcrm.com"
            />
            <span className="block text-xs text-foreground-subtle">
              <span className="text-numeric">{recipients.length}</span> recipient
              {recipients.length === 1 ? '' : 's'}
              {invalidRecipients.length > 0 ? (
                <span className="ml-2 text-warning">Invalid: {invalidRecipients.join(', ')}</span>
              ) : null}
            </span>
          </label>
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={attachCsv}
                onChange={(event) => setAttachCsv(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
              />
              <span className="font-medium">
                Attach detailed CSV to email
                <span className="block text-xs font-normal text-foreground-subtle">
                  Includes every section as rows for spreadsheet analysis.
                </span>
              </span>
            </label>
            <label className="block space-y-1.5">
              <FieldLabel label="Delivery cadence" />
              <select
                value={cadence}
                onChange={(event) => setCadence(event.target.value as Cadence)}
                className={selectFieldClasses}
              >
                <option value="one-time">Send once now</option>
                <option value="daily">Daily, 7am MT</option>
                <option value="weekly">Weekly (Mondays, 7am MT)</option>
                <option value="monthly">Monthly (1st, 7am MT)</option>
              </select>
            </label>
            {cadence !== 'one-time' && (
              <label className="block space-y-1.5">
                <FieldLabel label="Schedule label" />
                <Input
                  type="text"
                  value={scheduleName}
                  onChange={(event) => setScheduleName(event.target.value)}
                  placeholder={`${reportName} (${cadence})`}
                />
              </label>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
          <span className="text-eyebrow pb-2.5 text-foreground-subtle">Presets</span>
          <label className="block space-y-1.5">
            <FieldLabel label="Load preset" />
            <select
              value={selectedPresetId}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedPresetId(v);
                if (v) loadPreset(v);
              }}
              className={cn(selectFieldClasses, 'w-48')}
            >
              <option value="">Load preset…</option>
              {reportPresets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <FieldLabel label="New preset name" />
            <Input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              className="w-44"
            />
          </label>
          <Button variant="secondary" onClick={savePreset}>
            Save as preset
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-4 text-sm text-foreground-muted">
          <div>
            {selectedMetrics.length ? (
              <span className="font-medium">
                <span className="text-numeric">{selectedMetrics.length}</span> metric
                {selectedMetrics.length === 1 ? '' : 's'} selected
              </span>
            ) : (
              <span className="font-medium text-warning">Select at least one metric.</span>
            )}
            <p className="text-foreground-subtle">
              {cadence === 'one-time'
                ? 'Email is sent immediately to the recipients above.'
                : `Recurring delivery: ${describeCadence(cadence as 'daily' | 'weekly' | 'monthly')}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleDownloadReportCsv} loading={csvLoading}>
              {csvLoading ? 'Building CSV…' : 'Download as CSV'}
            </Button>
            <Button onClick={handlePrimaryAction} loading={reportLoading}>
              {reportLoading
                ? 'Sending…'
                : cadence === 'one-time'
                  ? 'Send report now'
                  : 'Save schedule'}
            </Button>
          </div>
        </div>
      </FieldGroup>

      <FieldGroup
        title="Active scheduled reports"
        description="Recurring deliveries run at 7am America/Denver on their cadence."
        action={
          schedulesLoading ? (
            <span className="text-xs text-foreground-subtle">Loading…</span>
          ) : (
            <span className="text-xs text-foreground-subtle">
              <span className="text-numeric">{schedules.length}</span> active
            </span>
          )
        }
      >
        {schedules.length === 0 && !schedulesLoading ? (
          <p className="rounded-lg border border-dashed border-border bg-surface-muted/50 px-4 py-6 text-center text-sm text-foreground-subtle">
            No recurring reports yet. Pick a cadence above and choose <em>Save schedule</em>.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {schedules.map((schedule) => (
              <li key={schedule.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{schedule.name}</p>
                  <p className="text-xs text-foreground-subtle">
                    {describeCadence(schedule.cadence)} · <span className="text-numeric">{schedule.recipients.length}</span> recipient
                    {schedule.recipients.length === 1 ? '' : 's'} · <span className="text-numeric">{schedule.metrics.length}</span> metric
                    {schedule.metrics.length === 1 ? '' : 's'} · network {schedule.network}
                  </p>
                  <p className="text-xs text-foreground-subtle">
                    Next run: <span className="text-numeric">{formatRunAt(schedule.nextRunAt)}</span> · Last run:{' '}
                    <span className="text-numeric">{formatRunAt(schedule.lastRunAt)}</span>
                  </p>
                  <p className="truncate text-xs text-foreground-subtle">To: {schedule.recipients.join(', ')}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground-muted">
                    <input
                      type="checkbox"
                      checked={schedule.enabled}
                      onChange={(event) => void handleToggleSchedule(schedule.id, event.target.checked)}
                      className="h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
                    />
                    Enabled
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger-soft hover:text-danger"
                    onClick={() => void handleDeleteSchedule(schedule.id, schedule.name)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </FieldGroup>

      <FieldGroup
        title="CSV exports"
        description="Download detailed CSVs for referrals, agents, mortgage consultants, and deals."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(EXPORT_DEFINITIONS) as ExportReport[]).map((report) => {
            const definition = EXPORT_DEFINITIONS[report];
            const isDownloading = exporting === report;
            return (
              <div key={report} className="flex flex-col justify-between gap-3 rounded-lg border border-border p-4">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{definition.label}</h4>
                  <p className="mt-0.5 text-xs text-foreground-muted">{definition.helper}</p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  loading={isDownloading}
                  onClick={() => void handleDownloadCsv(report)}
                >
                  {isDownloading ? 'Preparing CSV…' : `Download ${definition.label.toLowerCase()} CSV`}
                </Button>
              </div>
            );
          })}
        </div>
      </FieldGroup>
    </div>
  );
}
