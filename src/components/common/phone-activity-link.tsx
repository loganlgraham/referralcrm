'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

interface PhoneActivityLinkProps {
  referralId: string;
  phone: string;
  recipient: string;
  recipientName?: string | null;
  className?: string;
  children?: ReactNode;
}

const logCallActivity = (referralId: string, message: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = JSON.stringify({ channel: 'call', content: message });
  const url = new URL(`/api/referrals/${referralId}/activities`, window.location.origin);

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url.toString(), blob);
      return;
    }

    void fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'include'
    }).catch((error) => {
      console.error('Failed to log call activity', error);
    });
  } catch (error) {
    console.error('Failed to log call activity', error);
  }
};

export function PhoneActivityLink({
  referralId,
  phone,
  recipient,
  recipientName,
  className,
  children
}: PhoneActivityLinkProps) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }

      const trimmedName = recipientName?.toString().trim();
      const messageBase = trimmedName ? `${recipient} ${trimmedName}` : recipient;
      const content = `Call initiated to ${messageBase} (${phone})`;
      logCallActivity(referralId, content);
    },
    [phone, recipient, recipientName, referralId]
  );

  return (
    <a
      href={`tel:${phone.replace(/[^0-9+]/g, '')}`}
      onClick={handleClick}
      className={clsx('text-primary-700 hover:underline', className)}
    >
      {children ?? phone}
    </a>
  );
}
