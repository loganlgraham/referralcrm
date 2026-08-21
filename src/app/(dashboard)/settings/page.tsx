import { Metadata } from 'next';
import { SettingsForm } from '@/components/forms/settings-form';

export const metadata: Metadata = {
  title: 'Settings | Referral CRM'
};

export default function SettingsPage() {
  return (
    <div className="max-w-5xl">
      <SettingsForm />
    </div>
  );
}
