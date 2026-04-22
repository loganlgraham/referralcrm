'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useTransition } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  totalPages: number;
  itemLabel?: string;
}

export function Pagination({ currentPage, totalItems, pageSize, totalPages, itemLabel = 'items' }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const searchParamsString = useMemo(() => searchParams.toString(), [searchParams]);

  const updateParams = useCallback(
    (updates: { page?: number; pageSize?: number }) => {
      const params = new URLSearchParams(searchParamsString);
      
      if (updates.page !== undefined) {
        if (updates.page <= 1) {
          params.delete('page');
        } else {
          params.set('page', updates.page.toString());
        }
      }
      
      if (updates.pageSize !== undefined) {
        if (updates.pageSize === 25) {
          params.delete('pageSize');
        } else {
          params.set('pageSize', updates.pageSize.toString());
        }
        // Reset to page 1 when page size changes
        params.delete('page');
      }
      
      startTransition(() => {
        const queryString = params.toString();
        router.replace(queryString ? `${pathname}?${queryString}` : pathname);
      });
    },
    [router, pathname, searchParamsString, startTransition]
  );

  const handlePrevious = () => {
    if (currentPage > 1) {
      updateParams({ page: currentPage - 1 });
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      updateParams({ page: currentPage + 1 });
    }
  };

  const handlePageSizeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newPageSize = Number(event.target.value);
    updateParams({ pageSize: newPageSize });
  };

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  if (totalItems === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <p className="text-sm text-foreground-muted">
          Showing <span className="font-medium text-foreground">{startItem}</span> to{' '}
          <span className="font-medium text-foreground">{endItem}</span> of{' '}
          <span className="font-medium text-foreground">{totalItems}</span> {itemLabel}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={handlePageSizeChange}
            disabled={isPending}
            className="rounded border border-border bg-surface-raised px-2 py-1 text-sm text-foreground-muted shadow-sm focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pageSize === 20 && <option value={20}>20</option>}
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentPage <= 1 || isPending}
            className="inline-flex items-center justify-center rounded border border-border bg-surface-raised px-2.5 py-1.5 text-sm font-medium text-foreground-muted shadow-sm transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Previous page"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="px-3 py-1.5 text-sm font-medium text-foreground-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={currentPage >= totalPages || isPending}
            className="inline-flex items-center justify-center rounded border border-border bg-surface-raised px-2.5 py-1.5 text-sm font-medium text-foreground-muted shadow-sm transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Next page"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
