'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency, formatNumber } from '@/utils/formatters';

type Role = 'admin' | 'manager' | 'mc' | 'agent' | 'viewer' | undefined;

interface KPIResponse {
  role?: Role;
  totalReferrals: number;
  closedReferrals: number;
  closeRate: number;
  expectedRevenueCents: number;
  amountPaidCents: number;
  earnedCommissionCents: number;
}

function LoadingCard() {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm animate-pulse">
      <div className="h-4 w-24 rounded bg-slate-200" />
      <div className="mt-2 h-8 w-32 rounded bg-slate-200" />
    </div>
  );
}

export function KPICards() {
  const [isMounted, setIsMounted] = useState(false);
  const { data, error } = useSWR<KPIResponse>('/api/referrals?summary=true', fetcher);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-800">
        Failed to load KPI data. Please try again later.
      </div>
    );
  }

  if (!isMounted || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <LoadingCard key={index} />
        ))}
      </div>
    );
  }

  const role = data.role;

  const baseCards = [
    { title: 'Total Referrals', value: formatNumber(data.totalReferrals) },
    { title: 'Closed Deals', value: formatNumber(data.closedReferrals) },
    { title: 'Close Rate', value: `${data.closeRate.toFixed(1)}%` }
  ];

  const roleSpecificCards = (() => {
    switch (role) {
      case 'agent':
        return [
          { title: 'Amount Paid', value: formatCurrency(data.amountPaidCents) },
          { title: 'Commission Earned', value: formatCurrency(data.earnedCommissionCents) }
        ];
      case 'mc':
        return [
          { title: 'Expected Revenue', value: formatCurrency(data.expectedRevenueCents) },
          { title: 'Amount Paid', value: formatCurrency(data.amountPaidCents) }
        ];
      default:
        return [
          { title: 'Expected Revenue', value: formatCurrency(data.expectedRevenueCents) },
          { title: 'Amount Paid', value: formatCurrency(data.amountPaidCents) }
        ];
    }
  })();

  const cards = [...baseCards, ...roleSpecificCards];

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
