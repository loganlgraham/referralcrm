import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderMagicLinkEmail, renderPasswordResetEmail } from '../src/lib/email-templates/auth';
import {
  renderAgentCloseEmail,
  renderBorrowerCloseEmail,
  renderNpsSurveyEmail,
  renderPaymentSentEmail,
} from '../src/lib/email-templates/close-nps';
import { generateFeeBreakdownEmailHTML } from '../src/lib/email-templates/fee-breakdown';
import { renderAgentWelcomeEmail, renderMcWelcomeEmail } from '../src/lib/email-templates/invites';
import { renderEmailHtml, renderEmailText } from '../src/lib/email-templates/layout';
import {
  EMAIL_COLORS,
  EMAIL_FONT_STACK,
  EMAIL_ICON_PATH,
  EMAIL_WORDMARK_PATH,
} from '../src/lib/email-templates/tokens';
import {
  renderAfcAdminNotificationEmail,
  renderAgentIntroEmail,
  renderAgentMcAssignmentThankYouEmail,
  renderAgentReferralReceiptEmail,
  renderInboundConfirmationEmail,
  renderMcAssignmentEmail,
  renderMcIntroEmail,
  renderNewReferralNotificationEmail,
  renderNoteEmail,
  renderPairingSummaryEmail,
} from '../src/lib/email-templates/referral-ops';
import {
  renderManualUpdateRequestEmail,
  renderScheduledUpdateReminderEmail,
} from '../src/lib/email-templates/update-request';

const PREVIEW_ORIGIN = 'https://referrio.app';
process.env.APP_URL = PREVIEW_ORIGIN;

/** The brand marks are served from the deployed origin, so previews inline them instead. */
function inlineBrandAssets(html: string): string {
  const dataUri = (file: string) =>
    `data:image/png;base64,${readFileSync(join(process.cwd(), 'public/brand', file)).toString('base64')}`;
  return html
    .replace(`${PREVIEW_ORIGIN}${EMAIL_ICON_PATH}`, dataUri('email-icon.png'))
    .replace(`${PREVIEW_ORIGIN}${EMAIL_WORDMARK_PATH}`, dataUri('email-wordmark.png'));
}

const outDir = join(process.cwd(), '.tmp/email-previews');
mkdirSync(outDir, { recursive: true });

const contacts = {
  buyerName: 'Jamie Lee',
  buyerEmail: 'jamie.lee@example.com',
  buyerPhone: '303-555-0100',
  status: 'Paired',
  lenderName: 'Pat Morgan',
  lenderEmail: 'pat.morgan@example.com',
  lenderPhone: '303-555-0199',
  loanFileNumber: 'LN-18422',
};

const dashboard = renderEmailHtml({
  preheader: 'Weekly dashboard · This week',
  heading: 'Weekly dashboard',
  bodyHtml: `<p style="margin:0 0 16px 0;font-family:${EMAIL_FONT_STACK};font-size:13px;line-height:20px;color:${EMAIL_COLORS.foregroundMuted};">Timeframe: This week &nbsp;&middot;&nbsp; Network: ALL</p>
<section><h3 style="margin:18px 0 4px;font-family:${EMAIL_FONT_STACK};font-size:16px;font-weight:600;color:${EMAIL_COLORS.foreground};">Executive summary</h3>
<table role="presentation" style="border-collapse:collapse;margin:6px 0 14px;width:100%;"><tbody>
<tr><td style="padding:4px 14px 4px 0;font-family:${EMAIL_FONT_STACK};font-size:14px;color:${EMAIL_COLORS.foregroundMuted};">New referrals</td><td style="padding:4px 0;font-family:${EMAIL_FONT_STACK};font-size:14px;font-weight:600;color:${EMAIL_COLORS.foreground};">18</td></tr>
<tr><td style="padding:4px 14px 4px 0;font-family:${EMAIL_FONT_STACK};font-size:14px;color:${EMAIL_COLORS.foregroundMuted};">Closed deals</td><td style="padding:4px 0;font-family:${EMAIL_FONT_STACK};font-size:14px;font-weight:600;color:${EMAIL_COLORS.foreground};">4</td></tr>
</tbody></table></section>`,
});

const samples: Array<{ slug: string; subject: string; html: string; text: string }> = [
  {
    slug: '01-magic-link',
    subject: 'Sign in to referrio.app',
    ...renderMagicLinkEmail({
      host: 'referrio.app',
      url: 'https://referrio.app/api/auth/callback/email?token=preview',
    }),
  },
  {
    slug: '02-password-reset',
    subject: 'Reset your Referral CRM password',
    ...renderPasswordResetEmail({
      name: 'Logan',
      resetUrl: 'https://referrio.app/reset-password?token=preview',
    }),
  },
  {
    slug: '03-agent-welcome',
    subject: 'American Home Agents Referral CRM – Get Started Now and start receiving referrals!',
    ...renderAgentWelcomeEmail({
      firstName: 'Logan',
      inviteLink: 'https://referrio.app/signup?role=agent&email=logan.graham%40americanhomeagents.com',
    }),
  },
  {
    slug: '04-mc-welcome',
    subject: 'Welcome to Referral CRM — complete your profile',
    ...renderMcWelcomeEmail({
      firstName: 'Logan',
      inviteLink: 'https://referrio.app/signup?role=mortgage-consultant&email=logan.graham%40americanhomeagents.com',
    }),
  },
  {
    slug: '05-update-request',
    subject: 'Action Needed: Update requested for Jamie Lee',
    ...renderManualUpdateRequestEmail({
      agentFirstName: 'Logan',
      buyerFirstName: 'Jamie',
      buyerName: 'Jamie Lee',
      referralUrl: 'https://referrio.app/referrals/preview',
      contacts,
    }),
  },
  {
    slug: '06-scheduled-reminder',
    subject: 'Scheduled Update: Jamie Lee',
    ...renderScheduledUpdateReminderEmail({
      agentFirstName: 'Logan',
      buyerName: 'Jamie Lee',
      daysSincePairing: 7,
      referralUrl: 'https://referrio.app/referrals/preview',
      contacts,
    }),
  },
  {
    slug: '07-agent-intro',
    subject: 'American Home Agents - New Referral!',
    ...renderAgentIntroEmail({
      agentFirstName: 'Logan',
      introCopy:
        "Thanks for partnering with the American Home Agents Concierge Service to help our referral, Jamie Lee. We're excited to get them in their new home!",
      borrowerName: 'Jamie Lee',
      borrowerEmail: contacts.buyerEmail,
      borrowerPhone: contacts.buyerPhone,
      notes: 'Pre-approved up to $550,000. Looking in Aurora and Parker.',
      oppositeAgent: {
        label: 'Selling Agent at American Home Agents',
        contact: { name: 'Alex Rivera', email: 'alex@example.com', phone: '303-555-0144' },
      },
      mc: {
        name: contacts.lenderName,
        email: contacts.lenderEmail,
        phone: contacts.lenderPhone,
        loanFileNumber: contacts.loanFileNumber,
      },
      borrowerFirstName: 'Jamie',
      contactMadeLink: 'https://referrio.app/referrals/preview/contact-made',
      contactAttemptedLink: 'https://referrio.app/referrals/preview/contact-attempted',
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '08-mc-intro',
    subject: 'Agent helping Jamie Lee',
    ...renderMcIntroEmail({
      lenderFirstName: 'Logan',
      borrowerName: 'Jamie Lee',
      loanFileNumber: contacts.loanFileNumber,
      agents: [
        {
          label: 'Buying Agent',
          name: 'Sam Carter',
          email: 'sam.carter@example.com',
          phone: '303-555-0111',
        },
      ],
      includeBorrowerDetails: true,
      borrowerEmail: contacts.buyerEmail,
      borrowerPhone: contacts.buyerPhone,
      borrowerFirstName: 'Jamie',
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '09-pairing-summary',
    subject: 'Referral Paired: Jamie Lee',
    ...renderPairingSummaryEmail({
      borrowerName: 'Jamie Lee',
      loanFileNumber: contacts.loanFileNumber,
      clientType: 'Buyer',
      pairedMembers: [
        { label: 'Buying Agent', name: 'Sam Carter', email: 'sam.carter@example.com', phone: '303-555-0111' },
        { label: 'Mortgage Consultant', name: contacts.lenderName, email: contacts.lenderEmail },
      ],
      referralLink: 'https://referrio.app/referrals/preview',
      introLinks: [
        { label: 'Sam Carter', url: 'https://referrio.app/compose-email?to=sam.carter@example.com' },
      ],
    }),
  },
  {
    slug: '10-new-referral',
    subject: 'New Referral: Jamie Lee',
    ...renderNewReferralNotificationEmail({
      borrowerLabel: 'Jamie Lee',
      summaryFields: ['Client Type: Buyer', 'Zip: 80014', 'Loan File Number: LN-18422', 'Email: jamie.lee@example.com'],
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '11-afc-admin',
    subject: 'New AFC referral from Sam Carter: Jamie Lee',
    ...renderAfcAdminNotificationEmail({
      agentName: 'Sam Carter',
      borrowerLabel: 'Jamie Lee',
      summaryFields: ['Agent: Sam Carter', 'Client Type: Buyer', 'Zip: 80014'],
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '12-agent-receipt',
    subject: 'We received your referral for Jamie Lee — thank you!',
    ...renderAgentReferralReceiptEmail({
      agentGreeting: 'Logan',
      borrowerLabel: 'Jamie Lee',
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '13-inbound-confirmation',
    subject: 'Referral received: Jamie Lee (AHA)',
    ...renderInboundConfirmationEmail({
      borrowerName: 'Jamie Lee',
      summaryFields: ['Channel: AHA', 'Client Type: Buyer', 'Zip: 80014'],
    }),
  },
  {
    slug: '14-mc-assignment',
    subject: 'New referral: Jamie Lee',
    ...renderMcAssignmentEmail({
      greetingName: 'Logan',
      borrowerLines: ['Borrower: Jamie Lee', 'Email: jamie.lee@example.com', 'Phone: 303-555-0100'],
      agentLines: ['Sam Carter', 'sam.carter@example.com', '303-555-0111'],
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '15-agent-mc-thank-you',
    subject: 'Thanks for your referral — Pat Morgan is on it for Jamie Lee',
    ...renderAgentMcAssignmentThankYouEmail({
      greeting: 'Logan',
      borrowerName: 'Jamie Lee',
      mcName: 'Pat Morgan',
      mcLines: ['Pat Morgan', 'Email: pat.morgan@example.com', 'Phone: 303-555-0199'],
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '16-note',
    subject: 'New note on Jamie Lee',
    ...renderNoteEmail({
      authorName: 'Kristen Truong',
      borrowerName: 'Jamie Lee',
      plainContent: 'Showed two homes this weekend. Client is writing an offer tomorrow.',
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '17-borrower-close',
    subject: 'Congrats on Your New Home!',
    ...renderBorrowerCloseEmail({
      borrowerFirstName: 'Jamie',
      agentName: 'Sam Carter',
      surveyUrl: 'https://referrio.app/nps/agent?token=preview',
    }),
  },
  {
    slug: '18-agent-close',
    subject: 'Congratulations on Your Closed Deal!',
    ...renderAgentCloseEmail({
      agentFirstName: 'Logan',
      borrowerDisplayName: 'Jamie Lee',
      lenderSurveyUrl: 'https://referrio.app/nps/lender?token=preview',
    }),
  },
  {
    slug: '19-nps-survey',
    subject: 'How likely are you to recommend us?',
    ...renderNpsSurveyEmail({
      firstName: 'Logan',
      question:
        'On a scale of 0-10, how likely are you to recommend American Financing to a client or colleague?',
      surveyUrl: 'https://referrio.app/nps/lender?token=preview',
    }),
  },
  {
    slug: '20-payment-sent',
    subject: 'Sam Carter sent a referral payment for Jamie Lee',
    ...renderPaymentSentEmail({
      agentName: 'Sam Carter',
      borrowerName: 'Jamie Lee',
      formattedAmount: '$4,250',
      referralLink: 'https://referrio.app/referrals/preview',
    }),
  },
  {
    slug: '21-fee-breakdown',
    subject: 'American Home Agents Referral Fee - Lee',
    ...generateFeeBreakdownEmailHTML({
      agent: { name: 'Sam Carter', email: 'sam.carter@example.com' },
      referral: {
        borrowerName: 'Jamie Lee',
        propertyAddress: '123 Main St',
        propertyCity: 'Denver',
        propertyState: 'CO',
        loanFileNumber: contacts.loanFileNumber,
      },
      deal: {
        closingDate: '2026-09-15',
        contractPriceCents: 50000000,
        commissionBasisPoints: 300,
        referralFeeBasisPoints: 2500,
        side: 'buy',
        usedAfc: true,
      },
      platformUrl: 'https://referrio.app/payments/preview',
    }),
  },
  {
    slug: '22-dashboard-report',
    subject: 'Weekly dashboard (This week)',
    html: dashboard,
    text: renderEmailText('Weekly dashboard\nTimeframe: This week | Network: ALL\n\nNew referrals: 18\nClosed deals: 4'),
  },
];

const manifest = samples.map((sample) => {
  const htmlPath = join(outDir, `${sample.slug}.html`);
  const textPath = join(outDir, `${sample.slug}.txt`);
  writeFileSync(htmlPath, inlineBrandAssets(sample.html));
  writeFileSync(textPath, sample.text);
  return { slug: sample.slug, subject: `[Preview] ${sample.subject}`, htmlPath, textPath };
});

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifest.length} preview emails to ${outDir}`);
