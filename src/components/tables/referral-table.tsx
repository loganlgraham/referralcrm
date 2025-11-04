'use client';

import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import Link from 'next/link';
import { ReferralStatus } from '@/constants/referrals';
import { formatCurrency } from '@/utils/formatters';

export interface ReferralRow {
  _id: string;
  createdAt: string;
  borrowerName: string;
  borrowerEmail: string;
  propertyZip: string;
  status: ReferralStatus;
  assignedAgentName?: string;
  lenderName?: string;
  referralFeeDueCents?: number;
}

const columns: ColumnDef<ReferralRow>[] = [
  {
    header: 'Borrower',
    accessorKey: 'borrowerName',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Link href={`/referrals/${row.original._id}`} className="font-medium text-brand">
          {row.original.borrowerName}
        </Link>
        <span className="text-xs text-slate-500">{row.original.borrowerEmail}</span>
      </div>
    )
  },
  {
    header: 'Zip',
    accessorKey: 'propertyZip'
  },
  {
    header: 'Status',
    accessorKey: 'status',
    cell: ({ row }) => <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">{row.original.status}</span>
  },
  {
    header: 'Agent',
    accessorKey: 'assignedAgentName',
    cell: ({ row }) => row.original.assignedAgentName || 'Unassigned'
  },
  {
    header: 'Lender/MC',
    accessorKey: 'lenderName',
    cell: ({ row }) => row.original.lenderName || '—'
  },
  {
    header: 'Referral Fee Due',
    accessorKey: 'referralFeeDueCents',
    cell: ({ row }) => formatCurrency(row.original.referralFeeDueCents || 0)
  },
  {
    header: 'Created',
    accessorKey: 'createdAt',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString()
  }
];

export function ReferralTable({ data }: { data: ReferralRow[] }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                <td key={cell.id} className="px-4 py-3 text-sm text-slate-700">
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
