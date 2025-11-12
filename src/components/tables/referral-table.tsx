'use client';

import { useMemo, useState } from 'react';
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { REFERRAL_STATUSES, ReferralStatus } from '@/constants/referrals';
import { formatCurrency, formatNumber } from '@/utils/formatters';

export interface ReferralRow {
  _id: string;
  createdAt: string;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  endorser?: string;
  clientType: 'Seller' | 'Buyer';
  lookingInZip: string;
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
}

type TableMode = 'admin' | 'mc' | 'agent';

type ReferralTableProps = {
  data: ReferralRow[];
  mode: TableMode;
};

interface StatusSelectProps {
  referralId: string;
  value: ReferralStatus;
}

function StatusSelect({ referralId, value }: StatusSelectProps) {
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
  );
}

const STATUS_BADGE_STYLES: Record<ReferralStatus, string> = {
  'New Lead': 'bg-sky-100 text-sky-700',
  Paired: 'bg-indigo-100 text-indigo-700',
  'In Communication': 'bg-amber-100 text-amber-700',
  'Showing Homes': 'bg-violet-100 text-violet-700',
  'Under Contract': 'bg-emerald-100 text-emerald-700',
  Closed: 'bg-green-100 text-green-700',
  Lost: 'bg-slate-200 text-slate-600',
  Terminated: 'bg-rose-100 text-rose-700'
};

const STATUS_LABELS: Record<ReferralStatus, string> = {
  'New Lead': 'New Lead',
  Paired: 'Paired',
  'In Communication': 'Communicating',
  'Showing Homes': 'Showing Homes',
  'Under Contract': 'Under Contract',
  Closed: 'Closed',
  Lost: 'Lost',
  Terminated: 'Terminated'
};

function StatusBadge({ status }: { status: ReferralStatus }) {
  const style = STATUS_BADGE_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
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
          className="inline-flex items-center rounded bg-brand px-3 py-1 font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="inline-flex items-center rounded border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DeleteReferralButton({ referralId, borrowerName }: { referralId: string; borrowerName: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (deleting) {
      return;
    }

    const confirmed = window.confirm(
      `Delete this referral for ${borrowerName}? This action cannot be undone and will remove any associated deals.`
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Unable to delete referral');
      }
      toast.success('Referral deleted');
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to delete referral');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="whitespace-nowrap rounded border border-rose-200 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  );
}

function buildColumns(mode: TableMode): ColumnDef<ReferralRow>[] {
  const borrowerColumn: ColumnDef<ReferralRow> = {
    header: 'Borrower',
    accessorKey: 'borrowerName',
    cell: ({ row }) => {
      const { _id, borrowerName, borrowerPhone } = row.original;
      return (
        <div className="flex flex-col">
          <Link href={`/referrals/${_id}`} className="font-medium text-brand">
            {borrowerName}
          </Link>
          {borrowerPhone ? (
            <span className="text-xs text-slate-500">{borrowerPhone}</span>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </div>
      );
    }
  };

  const createdColumn: ColumnDef<ReferralRow> = {
    header: 'Created',
    accessorKey: 'createdAt',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString()
  };

  if (mode === 'agent') {
    return [
      borrowerColumn,
      {
        header: 'Loan File #',
        accessorKey: 'loanFileNumber'
      },
      {
        header: 'Looking In (Zip)',
        accessorKey: 'lookingInZip'
      },
      {
        header: 'Pre-Approval',
        accessorKey: 'preApprovalAmountCents',
        cell: ({ row }) =>
          row.original.preApprovalAmountCents
            ? formatCurrency(row.original.preApprovalAmountCents)
            : '—'
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <StatusSelect referralId={row.original._id} value={row.original.status} />
      },
      {
        header: 'Notes',
        id: 'notes',
        cell: ({ row }) => <NoteComposer referralId={row.original._id} />
      },
      createdColumn
    ];
  }

  if (mode === 'mc') {
    return [
      borrowerColumn,
      {
        header: 'Loan File #',
        accessorKey: 'loanFileNumber'
      },
      {
        header: 'Agent Contact',
        id: 'agentContact',
        cell: ({ row }) => (
          <div className="flex flex-col text-sm">
            <span className="font-medium text-slate-700">{row.original.assignedAgentName || 'Unassigned'}</span>
            {row.original.assignedAgentPhone && (
              <span className="text-xs text-slate-500">{row.original.assignedAgentPhone}</span>
            )}
          </div>
        )
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />
      },
      createdColumn
    ];
  }

  return [
    borrowerColumn,
    {
      header: 'Loan File #',
      accessorKey: 'loanFileNumber'
    },
    {
      header: 'Looking In (Zip)',
      accessorKey: 'lookingInZip'
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />
    },
    {
      header: 'Agent',
      accessorKey: 'assignedAgentName',
      cell: ({ row }) => {
        const { assignedAgentName, assignedAgentPhone } = row.original;
        if (!assignedAgentName && !assignedAgentPhone) {
          return 'Unassigned';
        }
        return (
          <div className="flex flex-col text-sm">
            <span className="font-medium text-slate-700">{assignedAgentName || 'Unassigned'}</span>
            {assignedAgentPhone && <span className="text-xs text-slate-500">{assignedAgentPhone}</span>}
          </div>
        );
      }
    },
    {
      header: 'Lender/MC',
      accessorKey: 'lenderName',
      cell: ({ row }) => {
        const { lenderName, lenderPhone } = row.original;
        if (!lenderName && !lenderPhone) {
          return '—';
        }
        return (
          <div className="flex flex-col text-sm">
            <span className="font-medium text-slate-700">{lenderName || 'Unassigned'}</span>
            {lenderPhone && <span className="text-xs text-slate-500">{lenderPhone}</span>}
          </div>
        );
      }
    },
    createdColumn,
    {
      header: '',
      id: 'actions',
      cell: ({ row }) => (
        <DeleteReferralButton
          referralId={row.original._id}
          borrowerName={row.original.borrowerName}
        />
      )
    }
  ];
}

export function ReferralTable({ data, mode }: ReferralTableProps) {
  const columns = useMemo<ColumnDef<ReferralRow>[]>(() => buildColumns(mode), [mode]);
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
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
            <tr key={row.id} className="hover:bg-slate-50">
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
}

export function ReferralSummary({ summary }: { summary: ReferralSummaryMetrics }) {
  const { total, closedDeals, closeRate } = summary;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <dl className="grid gap-4 md:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Referrals</dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(total)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Closed Deals</dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(closedDeals)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Close Rate</dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">{closeRate.toFixed(1)}%</dd>
        </div>
      </dl>
    </div>
  );
}
