'use client';

import { useState } from 'react';
import { ReferralStatus } from '@/models/referral';
import { toast } from 'sonner';

interface Props {
  referralId: string;
  status: ReferralStatus;
  statuses: readonly ReferralStatus[];
}

export function StatusChanger({ referralId, status, statuses }: Props) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [loading, setLoading] = useState(false);

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as ReferralStatus;
    setLoading(true);
    try {
      const res = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        throw new Error('Failed to update status');
      }
      setCurrentStatus(nextStatus);
      toast.success('Referral status updated');
    } catch (error) {
      console.error(error);
      toast.error('Unable to update status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-xs uppercase text-slate-400">Pipeline Status</p>
      <select
        value={currentStatus}
        onChange={handleChange}
        className="mt-2 w-full rounded border border-slate-200 px-3 py-2 text-sm"
        disabled={loading}
      >
        {statuses.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </div>
  );
}
