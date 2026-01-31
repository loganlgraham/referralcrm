'use client';

import { ReactNode } from 'react';

interface DashboardClientShellProps {
  children: ReactNode;
}

export function DashboardClientShell({ children }: DashboardClientShellProps) {
  return <>{children}</>;
}
