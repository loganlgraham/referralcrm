import { Metadata } from 'next';

import { ProfileForm } from '@/components/forms/profile-form';
import { ProfileMetrics } from '@/components/dashboard/profile-metrics';

export const metadata: Metadata = {
  title: 'My Profile | Referral CRM',
};

export default function ProfilePage() {
  return (
    <div className="space-y-5">
      <ProfileForm />
      <ProfileMetrics />
    </div>
  );
}
