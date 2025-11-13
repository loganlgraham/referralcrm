import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';

export default async function HomePage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect('/login');
  }

  const role = session.user.role;

  if (role === 'admin') {
    redirect('/dashboard');
  }

  redirect('/referrals');
}
