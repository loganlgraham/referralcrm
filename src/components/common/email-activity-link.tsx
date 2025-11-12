'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

interface EmailActivityLinkProps {
  referralId: string;
  email: string;
  recipient: string;
  recipientName?: string | null;
  className?: string;
  children?: ReactNode;
}

const logEmailActivity = (referralId: string, message: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = JSON.stringify({ channel: 'email', content: message });
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
      console.error('Failed to log email activity', error);
    });
  } catch (error) {
    console.error('Failed to log email activity', error);
  }
};

export function EmailActivityLink({
  referralId,
  email,
  recipient,
  recipientName,
  className,
  children
}: EmailActivityLinkProps) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }

      const trimmedName = recipientName?.toString().trim();
      const messageBase = trimmedName ? `${recipient} ${trimmedName}` : recipient;
      const content = `Email sent to ${messageBase} (${email})`;
      logEmailActivity(referralId, content);
    },
    [email, recipient, recipientName, referralId]
  );

  return (
    <a
      href={`mailto:${email}`}
      onClick={handleClick}
      className={clsx('text-brand hover:underline', className)}
    >
      {children ?? email}
    </a>
  );
}
