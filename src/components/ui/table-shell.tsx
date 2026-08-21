import { forwardRef, type HTMLAttributes, type TableHTMLAttributes, type ThHTMLAttributes, type TdHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Outer wrapper: border, rounded, scrollable body, matches Card surface. */
export const TableShell = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function TableShell({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'overflow-hidden rounded-card border border-border bg-surface-raised shadow-card',
          className
        )}
        {...props}
      />
    );
  }
);

export const TableScroll = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function TableScroll({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('scrollbar-thin w-full overflow-x-auto', className)}
        {...props}
      />
    );
  }
);

export const Table = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(
  function Table({ className, ...props }, ref) {
    return (
      <table
        ref={ref}
        className={cn('w-full text-left text-sm text-foreground', className)}
        {...props}
      />
    );
  }
);

export const THead = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function THead({ className, ...props }, ref) {
    return (
      <thead
        ref={ref}
        className={cn(
          'sticky top-0 z-10 border-b border-border bg-surface-muted/80 text-xs font-medium uppercase tracking-wide text-foreground-muted backdrop-blur',
          className
        )}
        {...props}
      />
    );
  }
);

export const TBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TBody({ className, ...props }, ref) {
    return (
      <tbody ref={ref} className={cn('divide-y divide-border', className)} {...props} />
    );
  }
);

export const Tr = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  function Tr({ className, ...props }, ref) {
    return (
      <tr
        ref={ref}
        className={cn('transition hover:bg-surface-muted/60', className)}
        {...props}
      />
    );
  }
);

/**
 * `numeric` gives mono digits so columns line up down the page. `dense` drops a
 * density step for admin tables, which show far more rows per screen.
 */
type CellOptions = { numeric?: boolean; dense?: boolean };

export const Th = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement> & CellOptions>(
  function Th({ className, numeric, dense, ...props }, ref) {
    return (
      <th
        ref={ref}
        scope="col"
        className={cn(
          'px-4 font-medium first:pl-5 last:pr-5',
          dense ? 'py-2' : 'py-2.5',
          numeric && 'text-right',
          className
        )}
        {...props}
      />
    );
  }
);

export const Td = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement> & CellOptions>(
  function Td({ className, numeric, dense, ...props }, ref) {
    return (
      <td
        ref={ref}
        className={cn(
          'px-4 align-middle text-sm first:pl-5 last:pr-5',
          dense ? 'py-1.5' : 'py-3',
          numeric && 'text-numeric text-right',
          className
        )}
        {...props}
      />
    );
  }
);
