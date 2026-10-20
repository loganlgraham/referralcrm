import { escapeHtml } from '@/lib/email-templates/escape';
import { renderEmailHtml, renderEmailText } from '@/lib/email-templates/layout';
import { emailButton, emailList, emailParagraph } from '@/lib/email-templates/primitives';

export function renderAgentWelcomeEmail(data: {
  firstName: string;
  inviteLink: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: 'Get started on Referrio and start receiving referrals',
    heading: 'Welcome to Referrio',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.firstName)},`),
      emailParagraph(
        "You've been added to Referrio, our private, custom referral CRM for American Home Agents' out-of-state partners."
      ),
      emailParagraph(
        "We built this to make referrals easier—not more work. It's a simple, secure place to see your assigned referrals, leave quick updates, and stay aligned with the mortgage consultant without extra emails or check-ins."
      ),
      emailParagraph("Once you complete your profile and create your password, you'll be able to:"),
      emailList([
        'View your referrals in one place',
        'Drop quick updates as things move forward',
        'Track progress and communicate with the team',
      ]),
      emailParagraph(
        'This CRM is exclusively for our American Home Agents referral partners and American Financing and is only visible to you and the involved team.'
      ),
      emailParagraph(
        "Thanks for collaborating with American Home Agents—we're excited to work together and provide great service to our referred clients. Let us know if you have any questions or need help getting set up."
      ),
      emailButton(data.inviteLink, 'Complete your profile and create your password'),
    ].join(''),
  });
  const text = renderEmailText(`Hi ${data.firstName},

You've been added to Referrio, our private, custom referral CRM for American Home Agents' out-of-state partners.

We built this to make referrals easier—not more work. It's a simple, secure place to see your assigned referrals, leave quick updates, and stay aligned with the mortgage consultant without extra emails or check-ins.

Once you complete your profile and create your password, you'll be able to:

• View your referrals in one place
• Drop quick updates as things move forward
• Track progress and communicate with the team

This CRM is exclusively for our American Home Agents referral partners and American Financing and is only visible to you and the involved team.

Thanks for collaborating with American Home Agents—we're excited to work together and provide great service to our referred clients. Let us know if you have any questions or need help getting set up.

Complete your profile and create your password: ${data.inviteLink}`);
  return { html, text };
}

export function renderMcWelcomeEmail(data: {
  firstName: string;
  inviteLink: string;
}): { html: string; text: string } {
  const html = renderEmailHtml({
    preheader: 'Complete your Referrio profile',
    heading: 'Welcome to Referrio',
    bodyHtml: [
      emailParagraph(`Hi ${escapeHtml(data.firstName)},`),
      emailParagraph(
        'You have been invited to Referrio. Please complete your profile and choose a password to finish setting up your login.'
      ),
      emailButton(data.inviteLink, 'Complete your profile'),
      emailParagraph('If you were not expecting this invitation, please contact your admin.', { muted: true }),
    ].join(''),
  });
  const text = renderEmailText(`Hi ${data.firstName},

You have been invited to Referrio. Please complete your profile and choose a password to finish setting up your login.

Complete your profile: ${data.inviteLink}

If you were not expecting this invitation, please contact your admin.`);
  return { html, text };
}
