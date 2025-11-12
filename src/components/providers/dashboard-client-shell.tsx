'use client';

import { ReactNode } from 'react';

import { FollowUpTaskProvider } from '@/components/referrals/follow-up-task-provider';

interface DashboardClientShellProps {
  children: ReactNode;
}

export function DashboardClientShell({ children }: DashboardClientShellProps) {
  return <FollowUpTaskProvider>{children}</FollowUpTaskProvider>;
}
