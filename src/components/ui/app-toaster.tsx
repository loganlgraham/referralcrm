'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Toaster } from 'sonner';

const toastOptions = {
  classNames: {
    toast: 'group rounded-card border border-border bg-surface-raised text-sm text-foreground shadow-raised',
    title: 'text-sm font-medium text-foreground',
    description: 'text-xs text-foreground-muted',
    actionButton: 'bg-primary text-white hover:bg-primary-hover rounded-md px-3 py-1 text-xs font-semibold',
    cancelButton:
      'bg-surface-muted text-foreground-muted hover:bg-surface-subtle rounded-md px-3 py-1 text-xs font-semibold',
    closeButton: 'bg-surface-raised text-foreground-subtle hover:text-foreground border border-border',
    success: 'border-success/40',
    error: 'border-danger/40',
    warning: 'border-warning/40',
    info: 'border-info/40'
  }
};

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return isMobile;
}

/**
 * Admin toasts on phones sit in the middle of the screen with equal gutters so
 * the full card stays on-screen. Desktop keeps the corner placement.
 */
export function AppToaster() {
  const { data: session } = useSession();
  const isMobile = useIsMobileViewport();
  const isAdmin = session?.user?.role === 'admin';
  const centerAdminToasts = isAdmin && isMobile;

  return (
    <Toaster
      position={centerAdminToasts ? 'top-center' : 'top-right'}
      closeButton
      theme="light"
      expand={centerAdminToasts}
      className={isAdmin ? 'admin-toaster' : undefined}
      offset={16}
      mobileOffset={16}
      toastOptions={toastOptions}
    />
  );
}
