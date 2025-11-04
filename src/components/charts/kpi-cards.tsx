'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatNumber } from '@/utils/formatters';

interface KPIResponse {
  requests: number;
  closings: number;
  conversion: number;
  expectedRevenueCents: number;
  receivedRevenueCents: number;
  avgTimeToFirstContactHours: number | null;
  avgDaysToContract: number | null;
  avgDaysToClose: number | null;
}

export function KPICards() {
  const [isMounted, setIsMounted] = useState(false);
  const { data, error } = useSWR<KPIResponse>('/api/referrals?summary=true', fetcher);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-white p-4 shadow-sm animate-pulse">
            <div className="h-4 bg-slate-200 rounded w-24" />
            <div className="h-8 bg-slate-200 rounded w-32 mt-2" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-800">
        Failed to load KPI data. Please try again later.
      </div>
    );
  }

  const cards = [
    { title: 'Requests', value: formatNumber(data.requests) },
    { title: 'Closings', value: formatNumber(data.closings) },
    { title: 'Closing Conversion %', value: `${data.conversion.toFixed(1)}%` },
    { title: 'Expected Revenue', value: formatCurrency(data.expectedRevenueCents) },
    { title: 'Received Revenue', value: formatCurrency(data.receivedRevenueCents) },
    {
      title: 'Avg Time to First Contact',
      value: data.avgTimeToFirstContactHours ? `${data.avgTimeToFirstContactHours.toFixed(1)} hrs` : '—'
    },
    {
      title: 'Avg Days to Contract',
      value: data.avgDaysToContract ? `${data.avgDaysToContract.toFixed(1)} days` : '—'
    },
    {
      title: 'Avg Days to Close',
      value: data.avgDaysToClose ? `${data.avgDaysToClose.toFixed(1)} days` : '—'
    }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.title} className="rounded-lg bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-500">{card.title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
