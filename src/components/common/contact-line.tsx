'use client';

import { Mail, Phone } from 'lucide-react';
import type { ReactNode } from 'react';

import { CopyButton } from '@/components/common/copy-button';
import { EmailActivityLink } from '@/components/common/email-activity-link';
import { PhoneActivityLink } from '@/components/common/phone-activity-link';
import { cn } from '@/lib/cn';
import { formatPhoneNumber } from '@/utils/formatters';

type ContactLineKind = 'email' | 'phone';
type ContactLineLayout = 'chip' | 'row';

interface ContactLineProps {
  kind: ContactLineKind;
  value: string;
  referralId: string;
  recipient: string;
  recipientName?: string | null;
  /** Compact chips for the referral hero; stacked rows for assignment cards. */
  layout?: ContactLineLayout;
  className?: string;
}

function contactKindMeta(kind: ContactLineKind): {
  Icon: typeof Mail;
  copyLabel: string;
  tabular: boolean;
} {
  switch (kind) {
    case 'email':
      return { Icon: Mail, copyLabel: 'Copy email', tabular: false };
    case 'phone':
      return { Icon: Phone, copyLabel: 'Copy phone', tabular: true };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function ContactLine({
  kind,
  value,
  referralId,
  recipient,
  recipientName,
  layout = 'row',
  className
}: ContactLineProps) {
  const { Icon, copyLabel, tabular } = contactKindMeta(kind);
  const displayValue = kind === 'phone' ? formatPhoneNumber(value) || value : value;
  const textClass = cn(
    'font-display',
    tabular ? 'tabular-nums' : 'break-all',
    'text-xs'
  );

  let valueNode: ReactNode;
  switch (kind) {
    case 'email':
      valueNode = (
        <EmailActivityLink
          referralId={referralId}
          email={value}
          recipient={recipient}
          recipientName={recipientName}
          className={textClass}
        >
          {displayValue}
        </EmailActivityLink>
      );
      break;
    case 'phone':
      valueNode = (
        <PhoneActivityLink
          referralId={referralId}
          phone={value}
          recipient={recipient}
          recipientName={recipientName}
          className={textClass}
        >
          {displayValue}
        </PhoneActivityLink>
      );
      break;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }

  return (
    <div
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5',
        layout === 'chip' && 'rounded-pill bg-surface-muted px-2.5 py-1 ring-1 ring-inset ring-border',
        layout === 'row' && 'w-full',
        className
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" aria-hidden />
      <span className="min-w-0">{valueNode}</span>
      <CopyButton value={displayValue} label={copyLabel} />
    </div>
  );
}
