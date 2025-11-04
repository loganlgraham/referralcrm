'use client';

import { useState } from 'react';
import { toast } from 'sonner';

export function SettingsForm() {
  const [tier1, setTier1] = useState(25);
  const [tier2, setTier2] = useState(35);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    toast.success('Settings saved');
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Referral fee policy</h1>
      <p className="text-sm text-slate-500">Configure default referral fee tiers.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-600">
          Closed price ≤ $400k (% of commission)
          <input
            type="number"
            min="0"
            max="100"
            value={tier1}
            onChange={(event) => setTier1(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm font-medium text-slate-600">
          Closed price &gt; $400k (% of commission)
          <input
            type="number"
            min="0"
            max="100"
            value={tier2}
            onChange={(event) => setTier2(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white"
      >
        {loading ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
