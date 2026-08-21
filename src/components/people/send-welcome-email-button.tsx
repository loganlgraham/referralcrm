'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

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

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleSendWelcomeEmail}
      disabled={!recipientEmail}
      loading={sending}
    >
      {sending ? 'Sending…' : 'Send welcome email'}
    </Button>
  );
}

