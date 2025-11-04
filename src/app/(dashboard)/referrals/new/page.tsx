import { Metadata } from 'next';
import { ReferralForm } from '@/components/forms/referral-form';

export const metadata: Metadata = {
  title: 'New Referral | Referral CRM'
};

export default function NewReferralPage() {
  return (
    <div className="max-w-3xl">
      <ReferralForm />
    </div>
  );
}
