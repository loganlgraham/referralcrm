'use client';

import { useState } from 'react';
import { toast } from 'sonner';

interface SendWelcomeEmailButtonProps {
  endpoint: string;
  recipientName: string;
  recipientEmail?: string | null;
}

export function SendWelcomeEmailButton({ endpoint, recipientEmail, recipientName }: SendWelcomeEmailButtonProps) {
  const [sending, setSending] = useState(false);

  const handleSendWelcomeEmail = async () => {
    if (!recipientEmail) {
      toast.error('Add an email address before sending the welcome email.');
      return;
    }

    setSending(true);

    try {
      const response = await fetch(endpoint, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error ?? payload?.message ?? 'Unable to send welcome email');
      }

      toast.success(`Welcome email sent to ${recipientName}`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to send welcome email');
    } finally {
      setSending(false);
    }
  };

  const disabled = sending || !recipientEmail;

  return (
    <button
      type="button"
      onClick={handleSendWelcomeEmail}
      disabled={disabled}
      className="inline-flex items-center rounded-md border border-border bg-surface-raised px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-70"
    >
      {sending ? 'Sending…' : 'Send welcome email'}
    </button>
  );
}

