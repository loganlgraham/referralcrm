'use client';

import Link from 'next/link';
import { ChevronLeft, ChevronRight, Mail, MoreHorizontal, Phone, Trash2 } from 'lucide-react';
import { formatDateMST, formatPhoneNumber } from '@/utils/formatters';
import { CopyButton } from '@/components/common/copy-button';
import { EmailActivityLink } from '@/components/common/email-activity-link';
import { PhoneActivityLink } from '@/components/common/phone-activity-link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { AgentOriginMarker } from '@/components/referrals/agent-origin-marker';
import {
  headerActionClasses,
  headerIconActionClasses,
  metaPillClasses
} from '@/components/referrals/referral-rail';

interface AdminDetailHeaderProps {
  referralId: string;
  borrowerName: string;
  clientType: string;
  showAgentOriginMarker: boolean;
  /** Historical referral date when imported, otherwise when the referral entered the CRM. */
  referredAt?: string | Date | null;
  propertyLabel?: string | null;
  loanFileNumber?: string | null;
  borrowerEmail?: string | null;
  borrowerPhone?: string | null;
  backHref: string;
  showNav?: boolean;
  prevHref?: string | null;
  nextHref?: string | null;
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
}

export function AdminDetailHeader({
  referralId,
  borrowerName,
  clientType,
  showAgentOriginMarker,
  referredAt,
  propertyLabel,
  loanFileNumber,
  borrowerEmail,
  borrowerPhone,
  backHref,
  showNav = false,
  prevHref,
  nextHref,
  canDelete = false,
  deleting = false,
  onDelete
}: AdminDetailHeaderProps) {
  const referredDisplay = referredAt ? formatDateMST(referredAt) : null;
  const referredLabel = referredDisplay && referredDisplay !== '—' ? referredDisplay : null;
  const trimmedEmail = borrowerEmail?.trim() || null;
  const trimmedPhone = borrowerPhone?.trim() || null;
  const showMenu = canDelete && typeof onDelete === 'function';

  return (
    <header className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-foreground-subtle">
          <Link href={backHref} className="font-medium text-foreground-muted hover:text-foreground">
            Referrals
          </Link>
          {' / '}
          {borrowerName}
        </p>
        {showNav ? (
          <nav className="flex shrink-0 items-center gap-1" aria-label="Referral navigation">
            {prevHref ? (
              <Link href={prevHref} className={headerIconActionClasses} aria-label="Previous referral">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <button type="button" className={headerIconActionClasses} disabled aria-label="Previous referral">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
            )}
            {nextHref ? (
              <Link href={nextHref} className={headerIconActionClasses} aria-label="Next referral">
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <button type="button" className={headerIconActionClasses} disabled aria-label="Next referral">
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            )}
          </nav>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
        <div className="min-w-0">
          <p className="text-eyebrow text-foreground-muted">
            {clientType}
            {referredLabel ? ` · Referred ${referredLabel}` : null}
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-[28px] font-extrabold leading-tight tracking-[-0.035em] text-foreground sm:text-[32px]">
              {borrowerName}
            </h1>
            <CopyButton value={borrowerName} label="Copy name" />
            {showAgentOriginMarker ? <AgentOriginMarker size="md" /> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 pb-1">
          {trimmedEmail ? (
            <EmailActivityLink
              referralId={referralId}
              email={trimmedEmail}
              recipient="Borrower"
              recipientName={borrowerName}
              className={`${headerActionClasses} hover:no-underline`}
            >
              <Mail className="h-4 w-4" aria-hidden />
              Email
            </EmailActivityLink>
          ) : null}
          {trimmedPhone ? (
            <PhoneActivityLink
              referralId={referralId}
              phone={trimmedPhone}
              recipient="Borrower"
              recipientName={borrowerName}
              className={`${headerActionClasses} hover:no-underline`}
            >
              <Phone className="h-4 w-4" aria-hidden />
              Call
            </PhoneActivityLink>
          ) : null}
          {showMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={headerIconActionClasses} aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem destructive disabled={deleting} onSelect={() => onDelete?.()}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {deleting ? 'Deleting…' : 'Delete referral'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {propertyLabel?.trim() || loanFileNumber?.trim() || trimmedEmail || trimmedPhone ? (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {propertyLabel?.trim() ? <span className={metaPillClasses}>{propertyLabel}</span> : null}
            {loanFileNumber?.trim() ? (
              <span className={metaPillClasses}>
                Loan <span className="text-numeric text-foreground">{loanFileNumber}</span>
                <CopyButton value={loanFileNumber} label="Copy loan number" />
              </span>
            ) : null}
          </div>
          <BorrowerContactLine
            referralId={referralId}
            borrowerName={borrowerName}
            email={trimmedEmail}
            phone={trimmedPhone}
          />
        </div>
      ) : null}
    </header>
  );
}

function BorrowerContactLine({
  referralId,
  borrowerName,
  email,
  phone
}: {
  referralId: string;
  borrowerName: string;
  email: string | null;
  phone: string | null;
}) {
  const phoneDisplay = phone ? formatPhoneNumber(phone) || phone : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-foreground-muted sm:ml-auto sm:justify-end">
      {email ? (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <EmailActivityLink
            referralId={referralId}
            email={email}
            recipient="Borrower"
            recipientName={borrowerName}
            className="min-w-0 break-all text-foreground-muted hover:text-foreground"
          >
            {email}
          </EmailActivityLink>
          <CopyButton value={email} label="Copy email" />
        </span>
      ) : null}
      {phone && phoneDisplay ? (
        <span className="inline-flex items-center gap-1.5">
          <PhoneActivityLink
            referralId={referralId}
            phone={phone}
            recipient="Borrower"
            recipientName={borrowerName}
            className="text-numeric text-foreground-muted hover:text-foreground"
          >
            {phoneDisplay}
          </PhoneActivityLink>
          <CopyButton value={phoneDisplay} label="Copy phone" />
        </span>
      ) : null}
      {!email && !phone ? <span>Contact information pending</span> : null}
    </div>
  );
}
