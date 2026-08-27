import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatDate } from '@/utils/formatters';

import { renderMagicLinkEmail, renderPasswordResetEmail } from '@/lib/email-templates/auth';
import { renderBorrowerCloseEmail } from '@/lib/email-templates/close-nps';
import { generateFeeBreakdownEmailHTML } from '@/lib/email-templates/fee-breakdown';
import { renderEmailHtml } from '@/lib/email-templates/layout';
import { emailButton } from '@/lib/email-templates/primitives';
import { EMAIL_COLORS, EMAIL_FOOTER_DEFAULT, EMAIL_RADIUS } from '@/lib/email-templates/tokens';
import { renderManualUpdateRequestEmail } from '@/lib/email-templates/update-request';

describe('email shell', () => {
  const html = renderEmailHtml({
    preheader: 'Preview text',
    heading: 'Heading',
    bodyHtml: emailButton('https://referrio.app/referrals/1', 'View referral'),
  });

  it('uses the DESIGN.md page background, card radius, and charcoal button', () => {
    expect(html).toContain(`background-color:${EMAIL_COLORS.background}`);
    expect(html).toContain(`border-radius:${EMAIL_RADIUS.card}`);
    expect(html).toContain(`background-color:${EMAIL_COLORS.primary}`);
    expect(html).toContain(EMAIL_FOOTER_DEFAULT);
    expect(html).toContain('/brand/email-icon.png');
    expect(html).toContain('/brand/email-wordmark.png');
    expect(html).toContain('alt="Referrio"');
  });

  it('does not use coral as a UI color', () => {
    expect(html).not.toContain(EMAIL_COLORS.brandCoral);
    expect(html).not.toContain('#0f172a');
  });

  it('never sets a standalone border-style, which expands one-sided rules into full boxes', () => {
    expect(html).not.toContain('border-style:');
  });
});

describe('email renderers', () => {
  it('renders a magic-link email in the shared shell', () => {
    const { html, text } = renderMagicLinkEmail({
      host: 'referrio.app',
      url: 'https://referrio.app/api/auth/callback/email?token=abc',
    });
    expect(html).toContain('Sign in to Referrio');
    expect(html).toContain('Sent by Referrio');
    expect(html).toContain(EMAIL_COLORS.primary);
    expect(text).toContain('https://referrio.app/api/auth/callback/email?token=abc');
  });

  it('renders a password-reset email with the original body copy', () => {
    const { html, text } = renderPasswordResetEmail({
      name: 'Logan',
      resetUrl: 'https://referrio.app/reset-password?token=xyz',
    });
    expect(html).toContain('Reset your password');
    expect(html).toContain('Referral CRM password');
    expect(text).toContain('This link expires in 30 minutes.');
  });

  it('renders a manual update request with contact cards', () => {
    const { html, text } = renderManualUpdateRequestEmail({
      agentFirstName: 'Sam',
      buyerFirstName: 'Jamie',
      buyerName: 'Jamie Lee',
      referralUrl: 'https://referrio.app/referrals/abc',
      contacts: {
        buyerName: 'Jamie Lee',
        buyerEmail: 'jamie@example.com',
        buyerPhone: '303-555-0100',
        status: 'Paired',
        lenderName: 'Pat Morgan',
        lenderEmail: 'pat@example.com',
        lenderPhone: '303-555-0199',
        loanFileNumber: '12345',
      },
    });
    expect(html).toContain('Log in to Referral Portal');
    expect(html).toContain('Buyer Info');
    expect(html).toContain('Mortgage Consultant at AFC');
    expect(html).toContain('Kristen Truong');
    expect(html).toContain('Thanks,<br>Referrio');
    expect(text).toContain('Thanks,\nReferrio');
    expect(html).not.toContain('Referral CRM Team');
  });

  it('renders a fee breakdown without a dark chrome header', () => {
    const { html } = generateFeeBreakdownEmailHTML({
      agent: { name: 'Sam Agent', email: 'sam@example.com' },
      referral: {
        borrowerName: 'Jamie Lee',
        propertyAddress: '123 Main St',
        propertyCity: 'Denver',
        propertyState: 'CO',
        loanFileNumber: 'LN-1',
      },
      deal: {
        closingDate: '2026-09-15',
        contractPriceCents: 50000000,
        commissionBasisPoints: 300,
        referralFeeBasisPoints: 2500,
        side: 'buy',
        usedAfc: true,
      },
      platformUrl: 'https://referrio.app/payments/1',
    });
    expect(html).toContain('Referral Fee Breakdown');
    expect(html).toContain('Action Required');
    expect(html).toContain('Net Commission to Agent');
    expect(html).toContain(EMAIL_COLORS.warningSoft);
    expect(html).toContain(EMAIL_COLORS.successOnSoft);
    expect(html).not.toContain('background: #0f172a');
    expect(html).not.toContain('background:#0f172a');
  });

  it('keeps a date-only closing date on its calendar day and derives the countdown', () => {
    const closing = new Date();
    closing.setDate(closing.getDate() + 10);
    const closingDate = `${closing.getFullYear()}-${String(closing.getMonth() + 1).padStart(2, '0')}-${String(
      closing.getDate()
    ).padStart(2, '0')}`;

    const { html, text } = generateFeeBreakdownEmailHTML({
      agent: { name: 'Sam Agent', email: 'sam@example.com' },
      referral: { borrowerName: 'Jamie Lee', propertyAddress: '123 Main St' },
      deal: {
        closingDate,
        contractPriceCents: 50000000,
        commissionBasisPoints: 300,
        referralFeeBasisPoints: 2500,
        side: 'buy',
        usedAfc: false,
      },
      platformUrl: 'https://referrio.app/payments/1',
    });

    expect(html).toContain(formatDate(closing));
    expect(html).toContain('Closing in 10 days');
    expect(text).toContain('Closing in 10 days');
    expect(html).not.toContain('7 days away');
  });

  it('omits the loan file number when the deal did not use AFC', () => {
    const { html } = generateFeeBreakdownEmailHTML({
      agent: { name: 'Sam Agent', email: 'sam@example.com' },
      referral: {
        borrowerName: 'Jamie Lee',
        propertyAddress: '123 Main St',
        loanFileNumber: 'LN-1',
      },
      deal: {
        closingDate: '2026-09-15',
        contractPriceCents: 50000000,
        commissionBasisPoints: 300,
        referralFeeBasisPoints: 2500,
        side: 'sell',
        usedAfc: false,
      },
      platformUrl: 'https://referrio.app/payments/1',
    });
    expect(html).toContain('Sell-side referral');
    expect(html).not.toContain('LN-1');
  });

  it('renders a borrower close email with a charcoal CTA', () => {
    const { html } = renderBorrowerCloseEmail({
      borrowerFirstName: 'Jamie',
      agentName: 'Sam Agent',
      surveyUrl: 'https://referrio.app/nps/agent?token=t',
    });
    expect(html).toContain('Congrats on your new home');
    expect(html).toContain('Rate Your Agent');
    expect(html).toContain(EMAIL_COLORS.primary);
    expect(html).toContain('Sent by Referrio');
  });
});

describe('email preview fixture', () => {
  it('writes a combined HTML preview for visual review', () => {
    const samples = [
      renderMagicLinkEmail({ host: 'referrio.app', url: 'https://referrio.app/signin' }).html,
      renderManualUpdateRequestEmail({
        agentFirstName: 'Sam',
        buyerFirstName: 'Jamie',
        buyerName: 'Jamie Lee',
        referralUrl: 'https://referrio.app/referrals/abc',
        contacts: {
          buyerName: 'Jamie Lee',
          buyerEmail: 'jamie@example.com',
          buyerPhone: '303-555-0100',
          status: 'Paired',
          lenderName: 'Pat Morgan',
          lenderEmail: 'pat@example.com',
          lenderPhone: '303-555-0199',
          loanFileNumber: '12345',
        },
      }).html,
      generateFeeBreakdownEmailHTML({
        agent: { name: 'Sam Agent', email: 'sam@example.com' },
        referral: {
          borrowerName: 'Jamie Lee',
          propertyAddress: '123 Main St',
          propertyCity: 'Denver',
          propertyState: 'CO',
          loanFileNumber: 'LN-1',
        },
        deal: {
          closingDate: '2026-09-15',
          contractPriceCents: 50000000,
          commissionBasisPoints: 300,
          referralFeeBasisPoints: 2500,
          side: 'buy',
          usedAfc: true,
        },
        platformUrl: 'https://referrio.app/payments/1',
      }).html,
    ].join('\n<hr style="margin:40px 0;border:none;border-top:8px solid #CBD5E1;">\n');

    const previewPath = join(process.cwd(), 'tests/fixtures/email-preview.html');
    writeFileSync(previewPath, samples);
    expect(samples).toContain('Sent by Referrio');
  });
});
