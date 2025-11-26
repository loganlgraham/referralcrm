'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ReminderSettingsToggle } from '@/components/referrals/reminder-settings-toggle';

const DASHBOARD_METRICS = [
  { id: 'summary', label: 'Executive summary (totals & close rate)' },
  { id: 'revenue', label: 'Revenue trends & expected revenue' },
  { id: 'deals', label: 'Deals closed, pipeline, and under contract' },
  { id: 'attachRate', label: 'AFC/AHA attach rates and lost deals' },
  { id: 'preApprovals', label: 'Pre-approval conversion by lender' },
  { id: 'geography', label: 'Revenue by geography and ZIP' },
  { id: 'network', label: 'Network filters (All / My Network)' },
  { id: 'termination', label: 'Terminated deals & lost referral fees' }
] as const;

type DashboardMetricId = (typeof DASHBOARD_METRICS)[number]['id'];

type ExportReport = 'referrals' | 'agents' | 'mcs' | 'deals';

const EXPORT_DEFINITIONS: Record<ExportReport, { label: string; helper: string; headers: string[]; rows: string[][] }>
  = {
    referrals: {
      label: 'Referrals',
      helper: 'All inbound and assigned referrals with borrower, source, and status.',
      headers: ['Referral ID', 'Borrower', 'Status', 'Assigned Agent', 'Source'],
      rows: [
        ['REF-4129', 'Jordan Lee', 'Active pipeline', 'Taylor Woods', 'Sphere of influence'],
        ['REF-4132', 'Priya Patel', 'Pre-approved', 'Amari Chen', 'Lender partner'],
        ['REF-4139', 'Chris Douglas', 'Under contract', 'Jamie Patel', 'AFC intake']
      ]
    },
    agents: {
      label: 'Agents',
      helper: 'Roster with market centers, production, and key contact info.',
      headers: ['Agent', 'Market center', 'Primary market', 'Active referrals', 'Email'],
      rows: [
        ['Taylor Woods', 'MC 104 - Denver', 'Denver, CO', '12', 'taylor.woods@example.com'],
        ['Amari Chen', 'MC 208 - Austin', 'Austin, TX', '7', 'amari.chen@example.com'],
        ['Jamie Patel', 'MC 332 - Phoenix', 'Phoenix, AZ', '9', 'jamie.patel@example.com']
      ]
    },
    mcs: {
      label: 'Mortgage consultants',
      helper: 'Lender partners with referral totals and pre-approval conversions.',
      headers: ['MC', 'Company', 'Market', 'Referrals received', 'Pre-approvals'],
      rows: [
        ['Alex Rivers', 'AFC Lending', 'Denver, CO', '18', '11'],
        ['Morgan Diaz', 'Summit Home Loans', 'Seattle, WA', '10', '6'],
        ['Skyler Ray', 'Gateway Mortgage', 'Dallas, TX', '14', '9']
      ]
    },
    deals: {
      label: 'Deals',
      helper: 'Closed and active deals with referral fee details.',
      headers: ['Deal', 'Status', 'Volume', 'Referral fee %', 'Assigned agent'],
      rows: [
        ['Deal-9821', 'Closed', '$725,000', '25%', 'Taylor Woods'],
        ['Deal-9824', 'Under contract', '$515,000', '35%', 'Amari Chen'],
        ['Deal-9833', 'Closed - awaiting payment', '$845,000', '30%', 'Jamie Patel']
      ]
    }
  };

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
  const [reportRecipient, setReportRecipient] = useState('ops@referralcrm.com');
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState<ExportReport | null>(null);

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

  const handleGenerateReport = async () => {
    if (!selectedMetrics.length) {
      toast.error('Select at least one dashboard metric to include.');
      return;
    }

    if (reportTimeframe === 'Custom export window' && (!customStartDate || !customEndDate)) {
      toast.error('Select a start and end date for the custom timeframe.');
      return;
    }

    setReportLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const timeframeLabel =
      reportTimeframe === 'Custom export window'
        ? `${customStartDate || 'Start'} to ${customEndDate || 'End'}`
        : reportTimeframe;
    toast.success(
      `Dashboard report "${reportName}" (${timeframeLabel}) created for ${selectedMetrics.length} metric${
        selectedMetrics.length === 1 ? '' : 's'
      }. We'll send it to ${reportRecipient}.`
    );
    setReportLoading(false);
  };

  const buildCsvContent = (headers: string[], rows: string[][]) => {
    const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    return [headers, ...rows]
      .map((row) => row.map((cell) => escapeCell(cell)).join(','))
      .join('\n');
  };

  const handleDownloadCsv = async (report: ExportReport) => {
    const { headers, rows, label } = EXPORT_DEFINITIONS[report];
    setExporting(report);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const csvContent = buildCsvContent(headers, rows);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${report}-report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExporting(null);
    toast.success(`${label} report is downloading.`);
  };

  return (
    <div className="space-y-6">
      <ReminderSettingsToggle
        title="Global task reminder emails"
        helperText="Choose how often to receive task reminders across every referral assigned to you. Admins apply this to all referrals."
      />
      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Referral fee policy</h1>
        <p className="text-sm text-slate-500">Configure default referral fee tiers.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-600">
            Closed price ≤ $400k (% of commission)
            <input
              type="number"
              min="0"
              max="100"
              value={tier1}
              onChange={(event) => setTier1(Number(event.target.value))}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-slate-600">
            Closed price &gt; $400k (% of commission)
            <input
              type="number"
              min="0"
              max="100"
              value={tier2}
              onChange={(event) => setTier2(Number(event.target.value))}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          {loading ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Dashboard metric reports</h2>
            <p className="text-sm text-slate-500">
              Create admin-only reports with every dashboard view, filter, and metric you select.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-sm font-semibold text-brand hover:text-brand/80"
          >
            {allMetricsSelected ? 'Clear selection' : 'Select all metrics'}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {DASHBOARD_METRICS.map((metric) => {
            const isChecked = selectedMetrics.includes(metric.id);
            return (
              <label
                key={metric.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                  isChecked ? 'border-brand/40 bg-brand/5' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleMetric(metric.id)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                />
                <span className="text-sm text-slate-700">{metric.label}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-600">
            Report name
            <input
              type="text"
              value={reportName}
              onChange={(event) => setReportName(event.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="Performance dashboard export"
            />
          </label>
          <label className="text-sm font-medium text-slate-600">
            Timeframe
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
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
            >
              <option>This week</option>
              <option>This month</option>
              <option>Last 90 days</option>
              <option>Year to date</option>
              <option>All</option>
              <option>Custom export window</option>
            </select>
          </label>
          {reportTimeframe === 'Custom export window' && (
            <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2">
              <label className="text-sm font-medium text-slate-600">
                Start date
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(event) => setCustomStartDate(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm font-medium text-slate-600">
                End date
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(event) => setCustomEndDate(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                />
              </label>
            </div>
          )}
          <label className="text-sm font-medium text-slate-600">
            Deliver to
            <input
              type="email"
              value={reportRecipient}
              onChange={(event) => setReportRecipient(event.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="analytics@yourteam.com"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
          <div>
            {selectedMetrics.length ? (
              <span className="font-medium">{selectedMetrics.length} metric(s) selected</span>
            ) : (
              <span className="font-medium text-amber-700">Select at least one metric.</span>
            )}
            <p className="text-slate-500">Includes charts, filters, and network scope from the performance dashboard.</p>
          </div>
          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={reportLoading}
            className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
          >
            {reportLoading ? 'Preparing report…' : 'Create dashboard report'}
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">CSV exports</h2>
        <p className="text-sm text-slate-500">Download individual reports for referrals, agents, mortgage consultants, and deals.</p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(Object.keys(EXPORT_DEFINITIONS) as ExportReport[]).map((report) => {
            const definition = EXPORT_DEFINITIONS[report];
            const isDownloading = exporting === report;
            return (
              <div key={report} className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 p-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-800">{definition.label}</h3>
                  <p className="text-sm text-slate-500">{definition.helper}</p>
                </div>
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => void handleDownloadCsv(report)}
                  className="w-full rounded border border-brand bg-white px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/5 disabled:opacity-70"
                >
                  {isDownloading ? 'Preparing CSV…' : `Download ${definition.label.toLowerCase()} CSV`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
