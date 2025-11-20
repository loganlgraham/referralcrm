'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type { DealRecord } from '@/components/referrals/deal-card';

interface ReferralDealsProps {
  deals?: DealRecord[] | null;
  onDealsChange?: (deals: DealRecord[]) => void;
}

export function ReferralDeals({ deals: initialDeals, onDealsChange }: ReferralDealsProps) {
  const [deals, setDeals] = useState<DealRecord[]>(() => initialDeals ?? []);
  const [deletingMap, setDeletingMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDeals(initialDeals ?? []);
  }, [initialDeals]);

  const handleDelete = useCallback(
    (dealId: string) =>
      async () => {
        const confirmed = window.confirm('Delete this deal? This action cannot be undone.');
        if (!confirmed) {
          return;
        }

        setDeletingMap((previous) => ({ ...previous, [dealId]: true }));

        try {
          const response = await fetch('/api/payments', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: dealId }),
          });

          if (!response.ok) {
            throw new Error('Unable to delete deal');
          }

          setDeals((previous) => {
            const nextDeals = previous.filter((deal) => deal._id !== dealId);
            onDealsChange?.(nextDeals);
            return nextDeals;
          });
          toast.success('Deal deleted');
        } catch (error) {
          console.error(error);
          toast.error(error instanceof Error ? error.message : 'Unable to delete deal');
        } finally {
          setDeletingMap((previous) => {
            const next = { ...previous };
            delete next[dealId];
            return next;
          });
        }
      },
    [onDealsChange]
  );

  if (!deals.length) {
    return <p className="text-sm text-slate-500">No deals available.</p>;
  }

  return (
    <div className="space-y-4">
      {deals.map((deal) => {
        const isDeleting = Boolean(deletingMap[deal._id]);

        return (
          <article
            key={deal._id}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-800">Deal ID: {deal._id}</p>
                <p className="text-sm text-slate-600">
                  {deal.side ? `Side: ${deal.side}` : 'Side not specified'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDelete(deal._id)}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 rounded border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
