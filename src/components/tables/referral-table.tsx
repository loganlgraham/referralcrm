'use client';

import { ReactNode, useMemo, useState, useTransition, useCallback, useEffect } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Clock } from 'lucide-react';

import { REFERRAL_STATUSES, ReferralStatus, type ReferralTimeline } from '@/constants/referrals';
import { formatCurrency, formatNumber, formatPhoneNumber } from '@/utils/formatters';
import { buildGmailComposeUrl } from '@/utils/gmail';
import { calculateTimelineDaysRemaining, formatTimelineCountdown } from '@/utils/timeline-countdown';
export interface ReferralRow {
  _id: string;
  createdAt: string;
  updatedAt?: string | null;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  endorser?: string;
  clientType: 'Seller' | 'Buyer' | 'Both';
  dealSide?: 'buy' | 'sell' | null;
  lookingInZip: string;
  lookingInZips?: string[];
  borrowerCurrentAddress?: string;
  propertyAddress?: string;
  stageOnTransfer?: string;
  initialNotes?: string;
  loanFileNumber: string;
  status: ReferralStatus;
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  assignedAgentName?: string;
  assignedAgentEmail?: string;
  assignedAgentPhone?: string;
  lenderName?: string;
  lenderEmail?: string;
  lenderPhone?: string;
  referralFeeDueCents?: number;
  preApprovalAmountCents?: number;
  dealStatus?: string | null;
  dealStatusLabel?: string | null;
  origin?: 'agent' | 'mc' | 'admin';
  timeline?: ReferralTimeline;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  hasAhaOosAgentAttached?: boolean;
  hasAhaDesignatedAgentAttached?: boolean;
  hasAhaAgentAttached?: boolean;
  urgentTaskCount?: number;
  autoUpdateRemindersEnabled?: boolean;
}

type TableMode = 'admin' | 'mc' | 'agent';

type ReferralTableProps = {
  data: ReferralRow[] | undefined | null;
  mode: TableMode;
  showAgentOriginIndicator?: boolean;
  hideAgentColumn?: boolean;
};

interface StatusSelectProps {
  referralId: string;
  value: ReferralStatus;
  dealStatusLabel?: string | null;
}

function StatusSelect({ referralId, value, dealStatusLabel }: StatusSelectProps) {
  const [status, setStatus] = useState<ReferralStatus>(value);
  const [loading, setLoading] = useState(false);

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as ReferralStatus;
    if (nextStatus === 'Under Contract') {
      toast.info('Open the referral to record contract details before marking it Under Contract.');
      return;
    }
    setStatus(nextStatus);
    setLoading(true);

    try {
      const response = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      toast.success('Referral status updated');
    } catch (error) {
      console.error(error);
      toast.error('Unable to update status');
      setStatus(value);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <select
        value={status}
        onChange={handleChange}
        disabled={loading}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
      >
        {REFERRAL_STATUSES.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      {dealStatusLabel && dealStatusLabel !== status && (
        <p className="text-xs text-slate-500">Deal stage: {dealStatusLabel}</p>
      )}
    </div>
  );
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  'New Lead': 'bg-sky-100 text-sky-700',
  Paired: 'bg-indigo-100 text-indigo-700',
  'In Communication': 'bg-amber-100 text-amber-700',
  'Active Lead': 'bg-violet-100 text-violet-700',
  'Showing Homes': 'bg-violet-100 text-violet-700',
  'Under Contract': 'bg-slate-100 text-slate-700',
  Closed: 'bg-slate-200 text-slate-800',
  Lost: 'bg-slate-200 text-slate-600',
  Terminated: 'bg-rose-100 text-rose-700',
  'Past Inspection': 'bg-amber-100 text-amber-700',
  'Past Appraisal': 'bg-blue-100 text-blue-700',
  'Clear to Close': 'bg-slate-100 text-slate-700',
  'Payment Sent': 'bg-indigo-100 text-indigo-700',
  'Payment Received': 'bg-slate-200 text-slate-800'
};

const STATUS_LABELS: Record<string, string> = {
  'New Lead': 'New Lead',
  Paired: 'Paired',
  'In Communication': 'Communicating',
  'Active Lead': 'Active Lead',
  'Showing Homes': 'Active Lead',
  'Under Contract': 'Under Contract',
  Closed: 'Closed',
  Lost: 'Lost',
  Terminated: 'Terminated',
  'Past Inspection': 'Past Inspection',
  'Past Appraisal': 'Past Appraisal',
  'Clear to Close': 'Clear to Close',
  'Payment Sent': 'Payment Sent',
  'Payment Received': 'Payment Received'
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

function normalizeStatusForSort({
  status,
  dealStatusLabel,
}: Pick<ReferralRow, 'status' | 'dealStatusLabel'>) {
  const label = dealStatusLabel ?? STATUS_LABELS[status] ?? status;
  return label.toLocaleLowerCase();
}

function NoteComposer({ referralId }: { referralId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setNote('');
    setOpen(false);
  };

  const handleSubmit = async () => {
    if (!note.trim()) {
      toast.error('Add a note before saving');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'note', content: note.trim() })
      });

      if (!response.ok) {
        throw new Error('Failed to save note');
      }

      toast.success('Note saved');
      reset();
    } catch (error) {
      console.error(error);
      toast.error('Unable to save note');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-brand hover:underline"
      >
        Add note
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-700 shadow-sm focus:border-brand focus:outline-none"
        placeholder="Capture quick context for this referral"
        disabled={saving}
      />
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center rounded-lg bg-brand px-3 py-1 font-semibold text-white shadow-sm transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}


function SortButton({ 
  sortKey, 
  label, 
  currentSortBy, 
  currentSortDirection,
  onSortChange 
}: { 
  sortKey: string; 
  label: string;
  currentSortBy: string | null;
  currentSortDirection: 'asc' | 'desc' | null;
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
}) {
  const isActive = currentSortBy === sortKey;
  const direction = isActive ? currentSortDirection : null;
  const icon = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕';

  const handleClick = () => {
    if (isActive && direction === 'desc') {
      onSortChange(sortKey, 'asc');
    } else {
      onSortChange(sortKey, 'desc');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-1 text-left"
    >
      <span>{label}</span>
      <span className="text-[10px] text-slate-400">{icon}</span>
    </button>
  );
}

const sortableHeader = (
  label: string, 
  sortKey: string,
  currentSortBy: string | null,
  currentSortDirection: 'asc' | 'desc' | null,
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void
): ((props: { column: any }) => ReactNode) => () => (
  <SortButton 
    sortKey={sortKey} 
    label={label}
    currentSortBy={currentSortBy}
    currentSortDirection={currentSortDirection}
    onSortChange={onSortChange}
  />
);

function buildColumns(
  mode: TableMode,
  options: { 
    showAgentOriginIndicator?: boolean;
    hideAgentColumn?: boolean;
    currentSortBy?: string | null;
    currentSortDirection?: 'asc' | 'desc' | null;
    onSortChange?: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
    listParams?: string;
  } = {}
): ColumnDef<ReferralRow>[] {
  const { 
    showAgentOriginIndicator = false,
    hideAgentColumn = false,
    currentSortBy = null,
    currentSortDirection = null,
    onSortChange = () => {},
    listParams = '',
  } = options;

  const borrowerColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Borrower', 'borrowerName', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'borrowerName',
    cell: ({ row }) => {
      const { _id, borrowerName, borrowerPhone, borrowerEmail, urgentTaskCount } = row.original;
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            {showAgentOriginIndicator && row.original.origin === 'agent' ? (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full bg-slate-700"
                aria-label="Agent-created referral"
                title="Agent-created referral"
              />
            ) : null}
            <Link href={listParams ? `/referrals/${_id}?${listParams}` : `/referrals/${_id}`} className="font-medium text-brand">
              {borrowerName}
            </Link>
            {mode === 'admin' && (urgentTaskCount ?? 0) > 0 ? (
              <span
                className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                title={`${urgentTaskCount} overdue or due today`}
              >
                {urgentTaskCount}
              </span>
            ) : null}
          </div>
          {borrowerEmail && (
            <a
              href={buildGmailComposeUrl(borrowerEmail)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand hover:underline"
            >
              Email
            </a>
          )}
          {borrowerPhone ? (
            <a
              href={`tel:${borrowerPhone.replace(/[^0-9+]/g, '')}`}
              className="text-xs text-brand hover:underline"
            >
              {formatPhoneNumber(borrowerPhone)}
            </a>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </div>
      );
    }
  };

  const createdColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Created', 'createdAt', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'createdAt',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
  };

  const lastUpdatedColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Last Updated', 'updatedAt', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'updatedAt',
    cell: ({ row }) => {
      const updatedAt = row.original.updatedAt;
      return updatedAt ? new Date(updatedAt).toLocaleDateString() : '—';
    },
  };

  const renderTimelineCountdown = (row: ReferralRow) => {
    const daysRemaining = calculateTimelineDaysRemaining(row.timeline, row.createdAt);
    return formatTimelineCountdown(daysRemaining, row.timeline);
  };

  const timelineColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Timeline', 'timeline', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'timeline',
    cell: ({ row }) => renderTimelineCountdown(row.original),
  };

  if (mode === 'agent') {
    return [
      borrowerColumn,
      {
        header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'loanFileNumber'
      },
      timelineColumn,
      {
        header: sortableHeader('Pre-approval', 'preApprovalAmountCents', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'preApprovalAmountCents',
        cell: ({ row }) =>
          row.original.preApprovalAmountCents
            ? formatCurrency(row.original.preApprovalAmountCents)
            : '—'
      },
      {
        header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'status',
        cell: ({ row }) => (
          <StatusSelect
            referralId={row.original._id}
            value={row.original.status}
            dealStatusLabel={row.original.dealStatusLabel ?? null}
          />
        ),
      },
      {
        header: 'Notes',
        id: 'notes',
        cell: ({ row }) => <NoteComposer referralId={row.original._id} />,
        enableSorting: false,
      },
      createdColumn
    ];
  }

  if (mode === 'mc') {
    return [
      borrowerColumn,
      {
        header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'loanFileNumber'
      },
      timelineColumn,
      {
        header: 'Agent Contact',
        id: 'agentContact',
        cell: ({ row }) => (
          <div className="flex flex-col text-sm">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-700">{row.original.assignedAgentName || 'Unassigned'}</span>
              {row.original.autoUpdateRemindersEnabled && (
                <span title="Auto reminders enabled">
                  <Clock 
                    className="h-3.5 w-3.5 text-slate-400" 
                    aria-label="Auto reminders enabled"
                  />
                </span>
              )}
            </div>
            {row.original.assignedAgentEmail && (
              <a
                href={buildGmailComposeUrl(row.original.assignedAgentEmail)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand hover:underline"
              >
                Email
              </a>
            )}
            {row.original.assignedAgentPhone && (
              <a
                href={`tel:${row.original.assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
                className="text-xs text-brand hover:underline"
              >
                {formatPhoneNumber(row.original.assignedAgentPhone)}
              </a>
            )}
          </div>
        )
      },
      {
        header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
        accessorKey: 'status',
        cell: ({ row }) => (
          <StatusBadge status={row.original.dealStatusLabel ?? row.original.status} />
        ),
      },
      createdColumn
    ];
  }

  const agentColumn: ColumnDef<ReferralRow> = {
    header: sortableHeader('Agent', 'assignedAgentName', currentSortBy, currentSortDirection, onSortChange),
    accessorKey: 'assignedAgentName',
    cell: ({ row }) => {
      const { assignedAgentName, assignedAgentEmail, assignedAgentPhone, autoUpdateRemindersEnabled } = row.original;
      if (!assignedAgentName && !assignedAgentPhone && !assignedAgentEmail) {
        return 'Unassigned';
      }
      return (
        <div className="flex flex-col text-sm">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-700">{assignedAgentName || 'Unassigned'}</span>
            {autoUpdateRemindersEnabled && (
              <span title="Auto reminders enabled">
                <Clock 
                  className="h-3.5 w-3.5 text-slate-400" 
                  aria-label="Auto reminders enabled"
                />
              </span>
            )}
          </div>
          {assignedAgentEmail && (
            <a
              href={buildGmailComposeUrl(assignedAgentEmail)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand hover:underline"
            >
              Email
            </a>
          )}
          {assignedAgentPhone && (
            <a
              href={`tel:${assignedAgentPhone.replace(/[^0-9+]/g, '')}`}
              className="text-xs text-brand hover:underline"
            >
              {formatPhoneNumber(assignedAgentPhone)}
            </a>
          )}
        </div>
      );
    }
  };

  const adminColumns: ColumnDef<ReferralRow>[] = [
    borrowerColumn,
    {
      header: sortableHeader('Loan File #', 'loanFileNumber', currentSortBy, currentSortDirection, onSortChange),
      accessorKey: 'loanFileNumber'
    },
    timelineColumn,
    {
      header: sortableHeader('Status', 'status', currentSortBy, currentSortDirection, onSortChange),
      accessorKey: 'status',
      cell: ({ row }) => <StatusBadge status={row.original.dealStatusLabel ?? row.original.status} />,
    },
    ...(hideAgentColumn ? [] : [agentColumn]),
    {
      header: sortableHeader('Lender/MC', 'lenderName', currentSortBy, currentSortDirection, onSortChange),
      accessorKey: 'lenderName',
      cell: ({ row }) => {
        const { lenderName, lenderEmail, lenderPhone } = row.original;
        if (!lenderName && !lenderPhone && !lenderEmail) {
          return '—';
        }
        return (
          <div className="flex flex-col text-sm">
            <span className="font-medium text-slate-700">{lenderName || 'Unassigned'}</span>
            {lenderEmail && (
              <a
                href={buildGmailComposeUrl(lenderEmail)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand hover:underline"
              >
                Email
              </a>
            )}
            {lenderPhone && (
              <a
                href={`tel:${lenderPhone.replace(/[^0-9+]/g, '')}`}
                className="text-xs text-brand hover:underline"
              >
                {formatPhoneNumber(lenderPhone)}
              </a>
            )}
          </div>
        );
      }
    },
    createdColumn,
    lastUpdatedColumn
  ];

  return adminColumns;
}

export function ReferralTable({ data, mode, showAgentOriginIndicator, hideAgentColumn }: ReferralTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const searchParamsString = useMemo(() => searchParams.toString(), [searchParams]);

  const currentSortBy = searchParams.get('sortBy');
  const currentSortDirection = (searchParams.get('sortDirection') as 'asc' | 'desc' | null) || null;

  const listParams = useMemo(() => {
    const params = new URLSearchParams(searchParamsString);
    params.delete('page');
    params.delete('pageSize');
    return params.toString();
  }, [searchParamsString]);

  const handleSortChange = useCallback(
    (sortBy: string, sortDirection: 'asc' | 'desc') => {
      const params = new URLSearchParams(searchParamsString);
      params.set('sortBy', sortBy);
      params.set('sortDirection', sortDirection);
      params.delete('page');
      startTransition(() => {
        const queryString = params.toString();
        router.replace(queryString ? `${pathname}?${queryString}` : pathname);
      });
    },
    [router, pathname, searchParamsString, startTransition]
  );

  const columns = useMemo<ColumnDef<ReferralRow>[]>(
    () => buildColumns(mode, { 
      showAgentOriginIndicator,
      hideAgentColumn,
      currentSortBy,
      currentSortDirection,
      onSortChange: handleSortChange,
      listParams,
    }),
    [mode, showAgentOriginIndicator, hideAgentColumn, currentSortBy, currentSortDirection, handleSortChange, listParams]
  );

  // Ensure data is always an array - handle all edge cases
  // This is critical because useReactTable requires an iterable array
  const safeData = useMemo(() => {
    try {
      if (!data) return [];
      if (Array.isArray(data)) {
        // Double-check each item is valid
        return data.filter((item): item is ReferralRow => item != null && typeof item === 'object');
      }
      return [];
    } catch (error) {
      console.error('Error processing referral data:', error);
      return [];
    }
  }, [data]);

  const table = useReactTable({
    data: safeData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-zinc-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`px-4 py-3 text-xs font-semibold text-slate-500 ${
                    header.column.id === 'actions' ? 'text-right' : 'text-left'
                  }`}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-zinc-50">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`px-4 py-3 text-sm text-slate-700 ${
                    cell.column.id === 'actions' ? 'text-right' : ''
                  }`}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ReferralSummaryMetrics {
  total: number;
  closedDeals: number;
  closeRate: number;
  activeReferrals: number;
}

type ReferralSummaryMode = 'mc' | 'agent';

export function ReferralSummary({
  summary,
  mode
}: {
  summary: ReferralSummaryMetrics;
  mode: ReferralSummaryMode;
}) {
  const { total, closedDeals, closeRate, activeReferrals } = summary;

  const metrics =
    mode === 'agent'
      ? [
          {
            label: 'Total Referrals',
            value: formatNumber(total)
          },
          {
            label: 'Active Referrals',
            value: formatNumber(activeReferrals)
          },
          {
            label: 'Closed Referrals',
            value: formatNumber(closedDeals)
          },
          {
            label: 'Close Rate',
            value: `${closeRate.toFixed(1)}%`
          }
        ]
      : [
          {
            label: 'Total Referrals',
            value: formatNumber(total)
          },
          {
            label: 'Closed Deals',
            value: formatNumber(closedDeals)
          },
          {
            label: 'Close Rate',
            value: `${closeRate.toFixed(1)}%`
          }
        ];

  const columnClass = mode === 'agent' ? 'md:grid-cols-4' : 'md:grid-cols-3';

  return (
    <div className="card">
      <dl className={clsx('grid gap-4', columnClass)}>
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt className="text-xs font-semibold text-slate-500">{metric.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
