import { escapeHtml } from '@/lib/email-templates/escape';
import { EMAIL_COLORS, EMAIL_FONT_STACK, EMAIL_RADIUS } from '@/lib/email-templates/tokens';

export type EmailAlertKind = 'warning' | 'info' | 'success' | 'danger';

const ALERT_STYLES: Record<
  EmailAlertKind,
  { background: string; text: string; border: string; rule: string }
> = {
  warning: {
    background: EMAIL_COLORS.warningSoft,
    text: EMAIL_COLORS.warningForeground,
    border: EMAIL_COLORS.warningSoftBorder,
    rule: EMAIL_COLORS.warning,
  },
  info: {
    background: EMAIL_COLORS.infoSoft,
    text: EMAIL_COLORS.infoOnSoft,
    border: EMAIL_COLORS.infoSoftBorder,
    rule: EMAIL_COLORS.info,
  },
  success: {
    background: EMAIL_COLORS.successSoft,
    text: EMAIL_COLORS.successOnSoft,
    border: EMAIL_COLORS.successSoftBorder,
    rule: EMAIL_COLORS.success,
  },
  danger: {
    background: EMAIL_COLORS.dangerSoft,
    text: EMAIL_COLORS.danger,
    border: EMAIL_COLORS.dangerSoftBorder,
    rule: EMAIL_COLORS.danger,
  },
};

const OVERLINE_STYLE = `font-family:${EMAIL_FONT_STACK};font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.12em;text-transform:uppercase;color:${EMAIL_COLORS.foregroundSubtle};`;

export function emailOverline(label: string): string {
  return `<p style="margin:0 0 12px 0;${OVERLINE_STYLE}">${escapeHtml(label)}</p>`;
}

export function emailParagraph(html: string, options?: { muted?: boolean; size?: number }): string {
  const color = options?.muted ? EMAIL_COLORS.foregroundMuted : EMAIL_COLORS.foreground;
  const size = options?.size ?? 14;
  return `<p style="margin:0 0 16px 0;font-family:${EMAIL_FONT_STACK};font-size:${size}px;line-height:22px;color:${color};">${html}</p>`;
}

export function emailLink(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${EMAIL_COLORS.link};font-weight:600;text-decoration:underline;">${escapeHtml(label)}</a>`;
}

export function emailButton(href: string, label: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px 0;">
  <tr>
    <td align="center" bgcolor="${EMAIL_COLORS.primary}" style="background-color:${EMAIL_COLORS.primary};border-radius:${EMAIL_RADIUS.sm};">
      <a href="${escapeHtml(href)}" style="display:inline-block;box-sizing:border-box;padding:12px 24px;font-family:${EMAIL_FONT_STACK};font-size:14px;font-weight:600;line-height:20px;color:${EMAIL_COLORS.primaryForeground};text-decoration:none;border-radius:${EMAIL_RADIUS.sm};">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`.trim();
}

export function emailCard(title: string, innerHtml: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;background-color:${EMAIL_COLORS.backgroundSubtle};border:1px solid ${EMAIL_COLORS.border};border-radius:${EMAIL_RADIUS.card};">
  <tr>
    <td style="padding:18px 20px;">
      ${emailOverline(title)}
      ${innerHtml}
    </td>
  </tr>
</table>`.trim();
}

export function emailMetaRows(rows: Array<{ label: string; value: string }>): string {
  const cells = rows
    .map((row, index) => {
      const padding = index === rows.length - 1 ? '0' : '0 0 10px 0';
      const value = escapeHtml(row.value).replace(/\n/g, '<br>');
      return `<tr>
    <td valign="top" style="padding:${padding};padding-right:16px;font-family:${EMAIL_FONT_STACK};font-size:13px;line-height:20px;color:${EMAIL_COLORS.foregroundMuted};">${escapeHtml(row.label)}</td>
    <td valign="top" align="right" style="padding:${padding};font-family:${EMAIL_FONT_STACK};font-size:14px;font-weight:500;line-height:20px;color:${EMAIL_COLORS.foreground};">${value}</td>
  </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}</table>`;
}

export function emailAlert(kind: EmailAlertKind, html: string): string {
  const styles = ALERT_STYLES[kind];
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background-color:${styles.background};border:1px solid ${styles.border};border-left:3px solid ${styles.rule};border-radius:${EMAIL_RADIUS.md};">
  <tr>
    <td style="padding:14px 18px;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:22px;color:${styles.text};">
      ${html}
    </td>
  </tr>
</table>`.trim();
}

export function emailList(items: string[]): string {
  const lis = items
    .map(
      (item) =>
        `<li style="margin:0 0 6px 0;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:22px;color:${EMAIL_COLORS.foreground};">${escapeHtml(item)}</li>`
    )
    .join('');
  return `<ul style="margin:0 0 16px 0;padding-left:20px;">${lis}</ul>`;
}

export function emailQuote(html: string): string {
  return `<blockquote style="margin:0 0 16px 0;padding:2px 0 2px 16px;border-left:3px solid ${EMAIL_COLORS.borderStrong};font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:22px;color:${EMAIL_COLORS.foreground};">${html}</blockquote>`;
}

/** Headline figure panel for a single money amount, e.g. a net payout. */
export function emailFigurePanel(input: {
  label: string;
  value: string;
  caption?: string;
  valueColor?: string;
}): string {
  const valueColor = input.valueColor ?? EMAIL_COLORS.foreground;
  const caption = input.caption
    ? `<p style="margin:8px 0 0 0;font-family:${EMAIL_FONT_STACK};font-size:13px;line-height:20px;color:${EMAIL_COLORS.foregroundMuted};">${input.caption}</p>`
    : '';
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background-color:${EMAIL_COLORS.backgroundSubtle};border:1px solid ${EMAIL_COLORS.border};border-radius:${EMAIL_RADIUS.card};">
  <tr>
    <td style="padding:20px;">
      <p style="margin:0 0 6px 0;${OVERLINE_STYLE}">${escapeHtml(input.label)}</p>
      <p style="margin:0;font-family:${EMAIL_FONT_STACK};font-size:30px;font-weight:600;line-height:36px;letter-spacing:-0.02em;color:${valueColor};">${escapeHtml(input.value)}</p>
      ${caption}
    </td>
  </tr>
</table>`.trim();
}

export type EmailAmountRow = {
  label: string;
  value: string;
  note?: string;
  valueColor?: string;
  total?: boolean;
};

/** Ledger-style amount table: muted labels left, aligned figures right, ruled total. */
export function emailAmountRows(rows: EmailAmountRow[]): string {
  const cells = rows
    .map((row, index) => {
      const isLast = index === rows.length - 1;
      const topRule = row.total
        ? `border-top:1px solid ${EMAIL_COLORS.borderStrong};`
        : index === 0
          ? ''
          : `border-top:1px solid ${EMAIL_COLORS.border};`;
      const paddingTop = index === 0 ? 0 : row.total ? 14 : 12;
      const paddingBottom = isLast ? 0 : row.total ? 14 : 12;
      const labelColor = row.total ? EMAIL_COLORS.foreground : EMAIL_COLORS.foregroundMuted;
      const labelWeight = row.total ? 600 : 400;
      const valueColor = row.valueColor ?? EMAIL_COLORS.foreground;
      const valueSize = row.total ? 18 : 15;
      const note = row.note
        ? `<span style="display:block;font-size:12px;font-weight:400;line-height:16px;color:${EMAIL_COLORS.foregroundSubtle};">${escapeHtml(row.note)}</span>`
        : '';
      return `<tr>
    <td valign="top" style="${topRule}padding:${paddingTop}px 16px ${paddingBottom}px 0;font-family:${EMAIL_FONT_STACK};font-size:14px;font-weight:${labelWeight};line-height:20px;color:${labelColor};">${escapeHtml(row.label)}${note}</td>
    <td valign="top" align="right" style="${topRule}padding:${paddingTop}px 0 ${paddingBottom}px 0;font-family:${EMAIL_FONT_STACK};font-size:${valueSize}px;font-weight:600;line-height:24px;letter-spacing:-0.01em;color:${valueColor};white-space:nowrap;">${escapeHtml(row.value)}</td>
  </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${cells}</table>`;
}
