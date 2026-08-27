import { escapeHtml } from '@/lib/email-templates/escape';
import {
  EMAIL_COLORS,
  EMAIL_FONT_STACK,
  EMAIL_FOOTER_DEFAULT,
  EMAIL_ICON_PATH,
  EMAIL_RADIUS,
  EMAIL_WIDTH,
  EMAIL_WORDMARK_PATH,
} from '@/lib/email-templates/tokens';
import { getAppOrigin } from '@/lib/server/app-origin';

export type EmailRenderInput = {
  preheader?: string;
  eyebrow?: string;
  heading?: string;
  bodyHtml: string;
  footerNote?: string;
};

const GUTTER = 28;

function hairline(color: string = EMAIL_COLORS.border): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${color}" style="height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr></table>`;
}

export function renderEmailHtml(input: EmailRenderInput): string {
  const footer = input.footerNote ?? EMAIL_FOOTER_DEFAULT;
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>`
    : '';
  const eyebrow = input.eyebrow
    ? `<p style="margin:0 0 8px 0;font-family:${EMAIL_FONT_STACK};font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;color:${EMAIL_COLORS.foregroundSubtle};">${escapeHtml(input.eyebrow)}</p>`
    : '';
  const heading = input.heading
    ? `<h1 style="margin:0 0 20px 0;font-family:${EMAIL_FONT_STACK};font-size:24px;font-weight:600;line-height:32px;letter-spacing:-0.02em;color:${EMAIL_COLORS.foreground};">${escapeHtml(input.heading)}</h1>`
    : '';
  const origin = getAppOrigin();
  const iconUrl = `${origin}${EMAIL_ICON_PATH}`;
  const wordmarkUrl = `${origin}${EMAIL_WORDMARK_PATH}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(input.heading ?? 'Referrio')}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.background};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_COLORS.background};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${EMAIL_WIDTH}px;background-color:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};border-radius:${EMAIL_RADIUS.card};box-shadow:0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.12);">
          <tr>
            <td style="padding:24px ${GUTTER}px 20px ${GUTTER}px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:15px;">
                    <img src="${escapeHtml(iconUrl)}" width="32" height="32" alt="" style="display:block;border:0;width:32px;height:32px;">
                  </td>
                  <td style="vertical-align:middle;">
                    <img src="${escapeHtml(wordmarkUrl)}" width="121" height="28" alt="Referrio" style="display:block;border:0;width:121px;height:28px;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 ${GUTTER}px;">${hairline()}</td>
          </tr>
          <tr>
            <td style="padding:28px ${GUTTER}px 4px ${GUTTER}px;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:22px;color:${EMAIL_COLORS.foreground};">
              ${eyebrow}
              ${heading}
              ${input.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px ${GUTTER}px 0 ${GUTTER}px;">${hairline()}</td>
          </tr>
          <tr>
            <td style="padding:16px ${GUTTER}px 24px ${GUTTER}px;">
              <p style="margin:0;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:16px;color:${EMAIL_COLORS.foregroundSubtle};">${escapeHtml(footer)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderEmailText(body: string, footerNote?: string): string {
  const footer = footerNote ?? EMAIL_FOOTER_DEFAULT;
  return `${body.trim()}\n\n${footer}`;
}
