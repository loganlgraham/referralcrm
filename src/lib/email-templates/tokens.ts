/** DESIGN.md tokens mapped for email-safe inline styles. */

export const EMAIL_COLORS = {
  background: '#F1F5F9',
  backgroundSubtle: '#F8FAFC',
  surface: '#FFFFFF',
  foreground: '#0F1729',
  foregroundMuted: '#4F5C6D',
  foregroundSubtle: '#6E7D91',
  primary: '#1F2937',
  primaryForeground: '#FFFFFF',
  primaryHover: '#111827',
  link: '#111827',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  warning: '#DB7706',
  warningSoft: '#FEF7E1',
  warningSoftBorder: '#F3E2B8',
  warningForeground: '#1A0D00',
  info: '#0C6CE9',
  infoSoft: '#E6F1FE',
  infoSoftBorder: '#C7DDFB',
  infoOnSoft: '#0A5BC4',
  success: '#278B5D',
  successSoft: '#E7F9F0',
  successSoftBorder: '#BFE8D4',
  successOnSoft: '#186B47',
  successEmphasis: '#206B47',
  danger: '#D32222',
  dangerSoft: '#FDEDED',
  dangerSoftBorder: '#F6C9C9',
  brandCoral: '#E2694B',
} as const;

export const EMAIL_RADIUS = {
  sm: '6px',
  md: '8px',
  card: '14px',
} as const;

export const EMAIL_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const EMAIL_WIDTH = 600;

export const EMAIL_ICON_PATH = '/brand/email-icon.png';
export const EMAIL_WORDMARK_PATH = '/brand/email-wordmark.png';

export const EMAIL_FOOTER_DEFAULT = 'Sent by Referrio';
