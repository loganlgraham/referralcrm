import { Metadata } from 'next';

import { ProfileForm } from '@/components/forms/profile-form';

export const metadata: Metadata = {
  title: 'My Profile | Referral CRM',
};

export default function ProfilePage() {
  return (
    <div className="max-w-3xl">
      <ProfileForm />
    </div>
  );
}
