import { formatCurrency, formatDate } from '@/utils/formatters';
import { escapeHtml } from '@/lib/email-templates/escape';
import { renderEmailHtml, renderEmailText } from '@/lib/email-templates/layout';
import {
  emailAlert,
  emailAmountRows,
  emailButton,
  emailCard,
  emailFigurePanel,
  emailLink,
  emailMetaRows,
  emailParagraph,
} from '@/lib/email-templates/primitives';
import { EMAIL_COLORS, EMAIL_FONT_STACK } from '@/lib/email-templates/tokens';

export interface FeeBreakdownEmailData {
  agent: {
    name: string;
    email: string;
  };
  referral: {
    borrowerName: string;
    propertyAddress: string;
    propertyCity?: string | null;
    propertyState?: string | null;
    loanFileNumber?: string | null;
  };
  deal: {
    closingDate: string;
    contractPriceCents: number;
    commissionBasisPoints: number | null;
    commissionFlatFeeCents?: number | null;
    referralFeeBasisPoints: number;
    side: 'buy' | 'sell';
    usedAfc: boolean;
  };
  platformUrl: string;
}

const COORDINATOR = {
  name: 'Kristen Truong',
  email: 'kristen.truong@americanhomeagents.com',
};

const MAILING_ADDRESS = ['American Home Agents', '3045 S Parker Rd #200', 'Aurora, CO 80014'];

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface CalculatedAmounts {
  contractPrice: string;
  commissionLabel: string;
  commissionAmount: string;
  referralFeePercent: string;
  referralFeeAmount: string;
  netCommission: string;
}

function calculateAmounts(data: FeeBreakdownEmailData): CalculatedAmounts {
  const contractPrice = data.deal.contractPriceCents;
  const commissionBps = data.deal.commissionBasisPoints;
  const flatFeeCents = data.deal.commissionFlatFeeCents;
  const referralFeeBps = data.deal.referralFeeBasisPoints;

  const isFlatFee = flatFeeCents != null && flatFeeCents > 0;
  const commissionAmountCents = isFlatFee
    ? flatFeeCents
    : Math.round((contractPrice * (commissionBps ?? 0)) / 10000);

  const referralFeeAmountCents = Math.round((commissionAmountCents * referralFeeBps) / 10000);
  const netCommissionCents = commissionAmountCents - referralFeeAmountCents;

  const commissionLabel = isFlatFee
    ? 'Flat Fee'
    : `${((commissionBps ?? 0) / 100).toFixed(2)}%`;

  return {
    contractPrice: formatCurrency(contractPrice),
    commissionLabel,
    commissionAmount: formatCurrency(commissionAmountCents),
    referralFeePercent: `${(referralFeeBps / 100).toFixed(2)}%`,
    referralFeeAmount: formatCurrency(referralFeeAmountCents),
    netCommission: formatCurrency(netCommissionCents),
  };
}

/** Treats a bare `YYYY-MM-DD` as a calendar date so it never shifts a day in local time. */
function parseClosingDate(value: string): Date | null {
  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function describeTimeUntilClosing(closingDate: Date | null): string | null {
  if (!closingDate) {
    return null;
  }
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfClosing = new Date(
    closingDate.getFullYear(),
    closingDate.getMonth(),
    closingDate.getDate()
  );
  const days = Math.round(
    (startOfClosing.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (days < 0) {
    return null;
  }
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return 'tomorrow';
  }
  return `in ${days} days`;
}

function extractFirstName(fullName: string): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

function extractLastName(borrowerName: string): string {
  if (!borrowerName || borrowerName.trim().length === 0) {
    return 'Unknown';
  }
  const nameParts = borrowerName.trim().split(/\s+/);
  return nameParts[nameParts.length - 1] || borrowerName;
}

export function generateFeeBreakdownSubject(borrowerName: string): string {
  const lastName = extractLastName(borrowerName);
  return `American Home Agents Referral Fee - ${lastName}`;
}

export function generateFeeBreakdownEmailHTML(data: FeeBreakdownEmailData): { html: string; text: string } {
  const amounts = calculateAmounts(data);
  const closingDate = parseClosingDate(data.deal.closingDate);
  const closingDateFormatted = formatDate(closingDate ?? data.deal.closingDate);
  const countdown = describeTimeUntilClosing(closingDate);
  const dealSideLabel = data.deal.side === 'sell' ? 'Sell-side' : 'Buy-side';
  const agentFirstName = extractFirstName(data.agent.name);
  const propertyValue = [
    data.referral.propertyAddress,
    [data.referral.propertyCity, data.referral.propertyState].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join('\n');

  const referralRows = [
    { label: 'Borrower', value: data.referral.borrowerName },
    { label: 'Property', value: propertyValue },
    { label: 'Expected closing', value: closingDateFormatted },
    data.deal.usedAfc && data.referral.loanFileNumber
      ? { label: 'Loan file number', value: data.referral.loanFileNumber }
      : null,
    { label: 'Deal side', value: dealSideLabel },
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  const addressBlock = `<p style="margin:0 0 14px 0;font-family:${EMAIL_FONT_STACK};font-size:14px;font-weight:500;line-height:22px;color:${EMAIL_COLORS.foreground};">${MAILING_ADDRESS.map(
    (line) => escapeHtml(line)
  ).join('<br>')}</p>`;

  const bodyHtml = [
    emailParagraph(
      `${agentFirstName ? `Hi ${escapeHtml(agentFirstName)}, congratulations` : 'Congratulations'} on the upcoming closing for <strong>${escapeHtml(
        data.referral.borrowerName
      )}</strong>${countdown ? ` — closing ${escapeHtml(countdown)}` : ''}. Here is the referral fee breakdown for your records.`
    ),
    emailAlert(
      'warning',
      '<strong>Action Required:</strong> Review the figures below and confirm they match your settlement statement.'
    ),
    emailFigurePanel({
      label: 'Net Commission to Agent',
      value: amounts.netCommission,
      valueColor: EMAIL_COLORS.successOnSoft,
      caption: `Your ${escapeHtml(amounts.commissionAmount)} commission less the ${escapeHtml(
        amounts.referralFeePercent
      )} referral fee.`,
    }),
    emailCard(
      'Financial Breakdown',
      emailAmountRows([
        { label: 'Contract price', value: amounts.contractPrice },
        {
          label: 'Agent commission',
          note:
            amounts.commissionLabel === 'Flat Fee'
              ? 'Flat fee'
              : `${amounts.commissionLabel} of contract price`,
          value: amounts.commissionAmount,
        },
        {
          label: 'Referral fee',
          note: `${amounts.referralFeePercent} of agent commission`,
          value: `-${amounts.referralFeeAmount}`,
          valueColor: EMAIL_COLORS.danger,
        },
        {
          label: 'Net commission to agent',
          value: amounts.netCommission,
          total: true,
        },
      ])
    ),
    emailCard('Referral Details', emailMetaRows(referralRows)),
    emailCard(
      'Where to Send the Referral Fee',
      [
        addressBlock,
        emailParagraph(
          `Please include a copy of the settlement statement with the check, or email it to ${emailLink(
            `mailto:${COORDINATOR.email}`,
            COORDINATOR.email
          )} if you are wiring the referral fee (wiring instructions attached). Our W-9 is attached for tax purposes.`,
          { muted: true, size: 13 }
        ),
      ].join('')
    ),
    emailParagraph(
      `If anything above looks off, reach out to <strong>${escapeHtml(
        COORDINATOR.name
      )}</strong> before closing and she will get it sorted. Congratulations again, and thank you for your partnership.`
    ),
    emailButton(data.platformUrl, 'View Deal in Platform'),
  ].join('');

  const html = renderEmailHtml({
    preheader: `Net commission ${amounts.netCommission} — closing ${closingDateFormatted}`,
    eyebrow: `${dealSideLabel} referral${countdown ? ` · Closing ${countdown}` : ''}`,
    heading: 'Referral Fee Breakdown',
    bodyHtml,
  });

  const propertyText = [
    data.referral.propertyAddress,
    [data.referral.propertyCity, data.referral.propertyState].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join(', ');

  const text = renderEmailText(`REFERRAL FEE BREAKDOWN
${dealSideLabel} referral${countdown ? ` · Closing ${countdown}` : ''}

${agentFirstName ? `Hi ${agentFirstName}, congratulations` : 'Congratulations'} on the upcoming closing for ${data.referral.borrowerName}. Here is the referral fee breakdown for your records.

ACTION REQUIRED: Review the figures below and confirm they match your settlement statement.

NET COMMISSION TO AGENT: ${amounts.netCommission}
Your ${amounts.commissionAmount} commission less the ${amounts.referralFeePercent} referral fee.

FINANCIAL BREAKDOWN

Contract price: ${amounts.contractPrice}
Agent commission (${amounts.commissionLabel} of contract price): ${amounts.commissionAmount}
Referral fee (${amounts.referralFeePercent} of agent commission): -${amounts.referralFeeAmount}
Net commission to agent: ${amounts.netCommission}

REFERRAL DETAILS

Borrower: ${data.referral.borrowerName}
Property: ${propertyText}
Expected closing: ${closingDateFormatted}${
    data.deal.usedAfc && data.referral.loanFileNumber
      ? `\nLoan file number: ${data.referral.loanFileNumber}`
      : ''
  }
Deal side: ${dealSideLabel}

WHERE TO SEND THE REFERRAL FEE

${MAILING_ADDRESS.join('\n')}

Please include a copy of the settlement statement with the check, or email it to
${COORDINATOR.email} if you are wiring the referral fee (wiring instructions attached).
Our W-9 is attached for tax purposes.

If anything above looks off, reach out to ${COORDINATOR.name} before closing and she will
get it sorted. Congratulations again, and thank you for your partnership.

View Deal in Platform:
${data.platformUrl}`);

  return { html, text };
}
