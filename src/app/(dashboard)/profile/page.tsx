import { Metadata } from 'next';

import { ProfileForm } from '@/components/forms/profile-form';
import { ProfileMetrics } from '@/components/dashboard/profile-metrics';

export const metadata: Metadata = {
  title: 'My Profile | Referral CRM',
};

export default function ProfilePage() {
  return (
    <div>
      <div className="max-w-3xl">
        <ProfileForm />
      </div>
      <ProfileMetrics />
    </div>
  );
}
