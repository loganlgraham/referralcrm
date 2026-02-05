'use client';

import { useCallback, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

export function CopyButton({ value, label = 'Copy', className }: CopyButtonProps) {
  const [copying, setCopying] = useState(false);

  const handleClick = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!value.trim() || copying) return;
      setCopying(true);
      try {
        await navigator.clipboard.writeText(value.trim());
        toast.success('Copied');
      } catch {
        toast.error('Failed to copy');
      } finally {
        setCopying(false);
      }
    },
    [value, copying]
  );

  if (!value.trim()) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={copying}
      aria-label={label}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50',
        className
      )}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
