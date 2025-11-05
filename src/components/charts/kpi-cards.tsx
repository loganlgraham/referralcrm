'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { formatCurrency, formatNumber } from '@/utils/formatters';
import { SAMPLE_KPI_DATA, SampleKPIData } from '@/data/dashboard-sample';
import { fetcher } from '@/utils/fetcher';

export function KPICards() {
  const [displayData, setDisplayData] = useState<SampleKPIData>(SAMPLE_KPI_DATA);
  const { data, error } = useSWR<SampleKPIData>('/api/referrals?summary=true', fetcher);

  useEffect(() => {
    if (data) {
      setDisplayData(data);
    }
  }, [data]);

  const cards = [
    { title: 'Requests', value: formatNumber(displayData.requests) },
    { title: 'Closings', value: formatNumber(displayData.closings) },
    { title: 'Closing Conversion %', value: `${displayData.conversion.toFixed(1)}%` },
    { title: 'Expected Revenue', value: formatCurrency(displayData.expectedRevenueCents) },
    { title: 'Received Revenue', value: formatCurrency(displayData.receivedRevenueCents) },
    {
      title: 'Avg Time to First Contact',
      value: displayData.avgTimeToFirstContactHours
        ? `${displayData.avgTimeToFirstContactHours.toFixed(1)} hrs`
        : '—'
    },
    {
      title: 'Avg Days to Contract',
      value: displayData.avgDaysToContract ? `${displayData.avgDaysToContract.toFixed(1)} days` : '—'
    },
    {
      title: 'Avg Days to Close',
      value: displayData.avgDaysToClose ? `${displayData.avgDaysToClose.toFixed(1)} days` : '—'
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
      {error && (
        <div className="md:col-span-2 xl:col-span-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">
          Showing sample metrics because live data is unavailable.
        </div>
      )}
    </div>
  );
}
