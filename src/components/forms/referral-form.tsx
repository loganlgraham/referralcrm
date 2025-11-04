'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { toast } from 'sonner';

const referralSchema = z.object({
  borrowerName: z.string().min(1),
  borrowerEmail: z.string().email(),
  borrowerPhone: z.string().min(7),
  propertyZip: z.string().min(5),
  source: z.enum(['Lender', 'MC']),
  loanType: z.string().optional(),
  estPurchasePrice: z.number().optional()
});

export function ReferralForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      borrowerName: formData.get('borrowerName')?.toString() || '',
      borrowerEmail: formData.get('borrowerEmail')?.toString() || '',
      borrowerPhone: formData.get('borrowerPhone')?.toString() || '',
      propertyZip: formData.get('propertyZip')?.toString() || '',
      source: (formData.get('source')?.toString() as 'Lender' | 'MC') || 'MC',
      loanType: formData.get('loanType')?.toString() || undefined,
      estPurchasePrice: formData.get('estPurchasePrice')
        ? Number(formData.get('estPurchasePrice'))
        : undefined
    };

    const result = referralSchema.safeParse(payload);
    if (!result.success) {
      toast.error('Please fix validation errors');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/referrals', {
        method: 'POST',
        body: JSON.stringify(result.data),
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        throw new Error('Failed to create referral');
      }
      const { id } = await res.json();
      toast.success('Referral created');
      router.push(`/referrals/${id}`);
    } catch (error) {
      console.error(error);
      toast.error('Unable to create referral');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Create referral</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-600">
          Borrower name
          <input name="borrowerName" required className="mt-1 w-full rounded border border-slate-200 px-3 py-2" />
        </label>
        <label className="text-sm font-medium text-slate-600">
          Borrower email
          <input
            name="borrowerEmail"
            type="email"
            required
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm font-medium text-slate-600">
          Borrower phone
          <input name="borrowerPhone" required className="mt-1 w-full rounded border border-slate-200 px-3 py-2" />
        </label>
        <label className="text-sm font-medium text-slate-600">
          Property zip
          <input name="propertyZip" required className="mt-1 w-full rounded border border-slate-200 px-3 py-2" />
        </label>
        <label className="text-sm font-medium text-slate-600">
          Source
          <select name="source" className="mt-1 w-full rounded border border-slate-200 px-3 py-2">
            <option value="MC">MC</option>
            <option value="Lender">Lender</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-600">
          Loan type
          <input name="loanType" className="mt-1 w-full rounded border border-slate-200 px-3 py-2" />
        </label>
        <label className="text-sm font-medium text-slate-600">
          Estimated purchase price
          <input
            name="estPurchasePrice"
            type="number"
            min="0"
            step="1000"
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-dark"
      >
        {loading ? 'Creating…' : 'Create referral'}
      </button>
    </form>
  );
}
