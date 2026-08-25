import { formatCurrency, formatDate } from '@/utils/formatters';

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

  // Determine commission amount: flat fee takes precedence over basis points
  const isFlatFee = flatFeeCents != null && flatFeeCents > 0;
  const commissionAmountCents = isFlatFee
    ? flatFeeCents
    : Math.round((contractPrice * (commissionBps ?? 0)) / 10000);

  // Calculate referral fee amount
  const referralFeeAmountCents = Math.round((commissionAmountCents * referralFeeBps) / 10000);

  // Calculate net commission
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

/**
 * Extracts the last name from a borrower's full name
 */
function extractLastName(borrowerName: string): string {
  if (!borrowerName || borrowerName.trim().length === 0) {
    return 'Unknown';
  }
  const nameParts = borrowerName.trim().split(/\s+/);
  return nameParts[nameParts.length - 1] || borrowerName;
}

/**
 * Generates the subject line for the fee breakdown email
 */
export function generateFeeBreakdownSubject(borrowerName: string): string {
  const lastName = extractLastName(borrowerName);
  return `American Home Agents Referral Fee - ${lastName}`;
}

export function generateFeeBreakdownEmailHTML(data: FeeBreakdownEmailData): { html: string; text: string } {
  const amounts = calculateAmounts(data);
  const closingDateFormatted = formatDate(data.deal.closingDate);
  const dealSideLabel = data.deal.side === 'sell' ? 'Sell-side' : 'Buy-side';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: #0066cc;
      color: white;
      padding: 30px 20px;
      border-radius: 0;
    }
    .header h1 {
      margin: 0 0 8px 0;
      font-size: 24px;
      font-weight: 600;
    }
    .header p {
      margin: 0;
      opacity: 0.9;
      font-size: 16px;
    }
    .content {
      padding: 30px 20px;
    }
    .highlight {
      background: #fef3c7;
      padding: 15px;
      border-left: 4px solid #f59e0b;
      margin: 0 0 24px 0;
      border-radius: 4px;
    }
    .highlight strong {
      color: #92400e;
    }
    .section {
      background: white;
      padding: 24px;
      margin-bottom: 20px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }
    .section h2 {
      margin: 0 0 20px 0;
      font-size: 18px;
      color: #111827;
      font-weight: 600;
    }
    .info-row {
      margin-bottom: 16px;
    }
    .info-row:last-child {
      margin-bottom: 0;
    }
    .label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 4px;
      letter-spacing: 0.5px;
    }
    .value {
      font-size: 16px;
      color: #111827;
      font-weight: 500;
    }
    .financial-row {
      display: flex;
      justify-content: space-between;
      padding: 14px 0;
      border-bottom: 1px solid #e5e7eb;
      align-items: center;
    }
    .financial-row:last-child {
      border-bottom: none;
    }
    .financial-label {
      font-size: 15px;
      color: #374151;
    }
    .financial-value {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
    }
    .net-commission-row {
      background: #f0fdf4;
      margin: 0 -24px;
      padding: 14px 24px;
      border-top: 2px solid #059669;
    }
    .net-commission-row .financial-label {
      font-weight: 600;
      font-size: 16px;
    }
    .net-commission-row .financial-value {
      color: #059669;
      font-size: 18px;
    }
    .referral-fee-value {
      color: #dc2626;
    }
    .instruction-box {
      background: #eff6ff;
      padding: 20px;
      border-radius: 6px;
      border: 1px solid #bfdbfe;
      margin: 24px 0;
    }
    .instruction-box p {
      margin: 0;
      font-size: 15px;
      line-height: 1.6;
      color: #1e40af;
    }
    .button {
      display: inline-block;
      background: #0066cc;
      color: white !important;
      padding: 14px 28px;
      text-decoration: none;
      border-radius: 6px;
      margin: 20px 0;
      font-weight: 600;
      font-size: 15px;
    }
    .button:hover {
      background: #0052a3;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Referral Fee Breakdown</h1>
      <p>Closing Date: ${closingDateFormatted} (7 days away)</p>
    </div>
    
    <div class="content">
      <div class="highlight">
        <strong>Action Required:</strong> Please review the financial details below and verify accuracy.
      </div>

      <div class="section">
        <h2>Referral Information</h2>
        
        <div class="info-row">
          <div class="label">Borrower Name</div>
          <div class="value">${data.referral.borrowerName}</div>
        </div>
        
        <div class="info-row">
          <div class="label">Property Address</div>
          <div class="value">${data.referral.propertyAddress}${
  data.referral.propertyCity || data.referral.propertyState
    ? `<br>${[data.referral.propertyCity, data.referral.propertyState].filter(Boolean).join(', ')}`
    : ''
}</div>
        </div>
        
        <div class="info-row">
          <div class="label">Expected Closing Date</div>
          <div class="value">${closingDateFormatted}</div>
        </div>
        
        ${data.deal.usedAfc && data.referral.loanFileNumber ? `
        <div class="info-row">
          <div class="label">Loan File Number</div>
          <div class="value">${data.referral.loanFileNumber}</div>
        </div>
        ` : ''}
        
        <div class="info-row">
          <div class="label">Deal Side</div>
          <div class="value">${dealSideLabel}</div>
        </div>
      </div>

      <div class="section">
        <h2>Financial Breakdown</h2>
        
        <div class="financial-row">
          <span class="financial-label">Contract Price:</span>
          <span class="financial-value">${amounts.contractPrice}</span>
        </div>
        
        <div class="financial-row">
          <span class="financial-label">Agent Commission (${amounts.commissionLabel}):</span>
          <span class="financial-value">${amounts.commissionAmount}</span>
        </div>
        
        <div class="financial-row">
          <span class="financial-label">Referral Fee (${amounts.referralFeePercent}):</span>
          <span class="financial-value referral-fee-value">-${amounts.referralFeeAmount}</span>
        </div>
        
        <div class="financial-row net-commission-row">
          <span class="financial-label">Net Commission to Agent:</span>
          <span class="financial-value">${amounts.netCommission}</span>
        </div>
      </div>

      <div class="section" style="background: #f9fafb;">
        <h2>Payment Instructions</h2>
        
        <div class="info-row">
          <div class="label">Mailing Address</div>
          <div class="value" style="white-space: pre-line; line-height: 1.8;">
American Home Agents
3190 South Vaughn Way, Suite 550
Aurora, CO 80014
          </div>
        </div>
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0 0 12px 0; font-size: 15px; color: #374151; line-height: 1.6;">
            Please include a copy of the settlement statement with the check, or email it to 
            <a href="mailto:kristen.truong@americanhomeagents.com" style="color: #0066cc; text-decoration: none;">kristen.truong@americanhomeagents.com</a> 
            if wiring the referral fee (wiring instructions attached).
          </p>
          <p style="margin: 12px 0; font-size: 15px; color: #374151; line-height: 1.6;">
            Please also find our W9 attached for tax purposes.
          </p>
          <p style="margin: 12px 0 0 0; font-size: 15px; color: #374151; line-height: 1.6;">
            Please don't hesitate to reach out to Kristen if you have any questions or need further details. 
            Congratulations again on the upcoming closing, and thank you for your partnership!
          </p>
        </div>
      </div>

      <div class="instruction-box">
        <p>
          <strong>Please review these numbers for accuracy.</strong> If anything appears incorrect, 
          please contact <strong>Kristen Truong</strong> (CC'd on this email) to discuss.
        </p>
      </div>

      <center>
        <a href="${data.platformUrl}" class="button">
          View Deal in Platform
        </a>
      </center>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
REFERRAL FEE BREAKDOWN
Closing Date: ${closingDateFormatted} (7 days away)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ ACTION REQUIRED: Please review the financial details below and verify accuracy.

REFERRAL INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Borrower Name:           ${data.referral.borrowerName}
Property Address:        ${data.referral.propertyAddress}${
  data.referral.propertyCity || data.referral.propertyState
    ? `\n                         ${[data.referral.propertyCity, data.referral.propertyState].filter(Boolean).join(', ')}`
    : ''
}
Expected Closing Date:   ${closingDateFormatted}
${data.deal.usedAfc && data.referral.loanFileNumber ? `Loan File Number:        ${data.referral.loanFileNumber}` : ''}
Deal Side:              ${dealSideLabel}

FINANCIAL BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Contract Price:                    ${amounts.contractPrice}
Agent Commission (${amounts.commissionLabel}):           ${amounts.commissionAmount}
Referral Fee (${amounts.referralFeePercent}):              -${amounts.referralFeeAmount}
─────────────────────────────────────────────
Net Commission to Agent:            ${amounts.netCommission}

PAYMENT INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mailing Address:
American Home Agents
3190 South Vaughn Way, Suite 550
Aurora, CO 80014

Please include a copy of the settlement statement with the check, or email it to 
kristen.truong@americanhomeagents.com if wiring the referral fee (wiring instructions attached).

Please also find our W9 attached for tax purposes.

Please don't hesitate to reach out to Kristen if you have any questions or need further details. 
Congratulations again on the upcoming closing, and thank you for your partnership!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please review these numbers for accuracy. If anything appears incorrect, 
please contact Kristen Truong (CC'd on this email) to discuss.

View Deal in Platform:
${data.platformUrl}
  `.trim();

  return { html, text };
}
