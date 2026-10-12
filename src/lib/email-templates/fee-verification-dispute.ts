import { formatCurrency, formatDateMST } from '@/utils/formatters';
import { escapeHtml } from '@/lib/email-templates/escape';
import { renderEmailHtml, renderEmailText } from '@/lib/email-templates/layout';
import {
  emailAlert,
  emailButton,
  emailCard,
  emailMetaRows,
  emailParagraph,
  emailQuote,
} from '@/lib/email-templates/primitives';
import {
  computeFeeVerificationAmounts,
  feeVerificationFieldLabel,
  type FeeVerificationField,
  type FeeVerificationSnapshot,
} from '@/lib/fee-verification';

export interface FeeVerificationDisputeEmailData {
  agentName: string;
  agentEmail: string;
  borrowerName: string;
  propertyAddress: string | null;
  snapshot: FeeVerificationSnapshot & { closingDate: Date | string | null };
  corrections: Array<{ field: FeeVerificationField; correctValue: string }>;
  note: string | null;
  referralUrl: string;
}

export function describeEmailedValue(
  field: FeeVerificationField,
  snapshot: FeeVerificationDisputeEmailData['snapshot']
): string {
  const amounts = computeFeeVerificationAmounts(snapshot);
  switch (field) {
    case 'contractPrice':
      return formatCurrency(amounts.contractPriceCents);
    case 'commission':
      return amounts.isFlatFee
        ? `${formatCurrency(amounts.commissionCents)} (flat fee)`
        : `${(amounts.commissionPercent ?? 0).toFixed(2)}% (${formatCurrency(amounts.commissionCents)})`;
    case 'referralFee':
      return `${amounts.referralFeePercent.toFixed(2)}% (${formatCurrency(amounts.referralFeeCents)})`;
    case 'closingDate':
      return formatDateMST(snapshot.closingDate);
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

export function generateFeeVerificationDisputeSubject(borrowerName: string): string {
  return `Agent flagged fee breakdown numbers - ${borrowerName}`;
}

export function generateFeeVerificationDisputeEmail(
  data: FeeVerificationDisputeEmailData
): { html: string; text: string } {
  const correctionRows = data.corrections.map((correction) => ({
    label: feeVerificationFieldLabel(correction.field),
    value: `Emailed: ${describeEmailedValue(correction.field, data.snapshot)}\nAgent says: ${correction.correctValue}`,
  }));

  const dealRows = [
    { label: 'Client', value: data.borrowerName },
    data.propertyAddress ? { label: 'Property', value: data.propertyAddress } : null,
    { label: 'Agent', value: `${data.agentName} (${data.agentEmail})` },
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  const bodyHtml = [
    emailAlert(
      'warning',
      `<strong>${escapeHtml(data.agentName)}</strong> says the fee breakdown for <strong>${escapeHtml(
        data.borrowerName
      )}</strong> doesn't look right. The deal has not been changed — please review and update it if needed.`
    ),
    correctionRows.length > 0 ? emailCard('What the agent flagged', emailMetaRows(correctionRows)) : '',
    data.note ? emailCard('Agent note', emailQuote(escapeHtml(data.note).replace(/\n/g, '<br>'))) : '',
    emailCard('Deal', emailMetaRows(dealRows)),
    emailParagraph('Once the numbers are fixed, you can resend the fee breakdown from the deal.', {
      muted: true,
      size: 13,
    }),
    emailButton(data.referralUrl, 'Review Deal'),
  ].join('');

  const html = renderEmailHtml({
    preheader: `${data.agentName} flagged the fee breakdown for ${data.borrowerName}`,
    eyebrow: 'Fee breakdown review',
    heading: 'Agent Flagged the Numbers',
    bodyHtml,
  });

  const correctionText = data.corrections
    .map(
      (correction) =>
        `${feeVerificationFieldLabel(correction.field)}\n  Emailed: ${describeEmailedValue(
          correction.field,
          data.snapshot
        )}\n  Agent says: ${correction.correctValue}`
    )
    .join('\n');

  const text = renderEmailText(`AGENT FLAGGED THE NUMBERS

${data.agentName} says the fee breakdown for ${data.borrowerName} doesn't look right. The deal has not been changed - please review and update it if needed.
${correctionText ? `\nWHAT THE AGENT FLAGGED\n\n${correctionText}\n` : ''}${data.note ? `\nAGENT NOTE\n\n${data.note}\n` : ''}
DEAL

Client: ${data.borrowerName}${data.propertyAddress ? `\nProperty: ${data.propertyAddress}` : ''}
Agent: ${data.agentName} (${data.agentEmail})

Once the numbers are fixed, you can resend the fee breakdown from the deal.

Review Deal:
${data.referralUrl}`);

  return { html, text };
}
