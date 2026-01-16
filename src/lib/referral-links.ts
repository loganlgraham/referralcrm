import { createHmac, timingSafeEqual } from 'crypto';

const FALLBACK_APP_BASE_URL = 'https://referrio.app';
const CONTACT_ACTION_SECRET = process.env.CONTACT_ACTION_SECRET || process.env.NEXTAUTH_SECRET;

const normalizeBaseUrl = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed) return null;
  if (trimmed.startsWith('http')) return trimmed;
  return `https://${trimmed}`;
};

export const getReferralAppBaseUrl = (): string => {
  const configuredBaseUrl =
    normalizeBaseUrl(process.env.REFERRAL_APP_URL) ||
    normalizeBaseUrl(process.env.NEXTAUTH_URL) ||
    normalizeBaseUrl(process.env.APP_URL);

  if (configuredBaseUrl?.includes('referrio.app')) {
    return configuredBaseUrl;
  }

  return FALLBACK_APP_BASE_URL;
};

export const buildReferralLink = (referralId: string): string => {
  return `${getReferralAppBaseUrl()}/referrals/${referralId}`;
};

export const buildContactActionToken = (referralId: string): string | null => {
  if (!CONTACT_ACTION_SECRET) return null;

  const hmac = createHmac('sha256', CONTACT_ACTION_SECRET);
  hmac.update(referralId);
  return hmac.digest('hex');
};

export const buildContactActionLink = (referralId: string, action: string): string => {
  const baseUrl = getReferralAppBaseUrl();
  const normalizedAction = encodeURIComponent(action);
  const token = buildContactActionToken(referralId);
  const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
  return `${baseUrl}/api/referrals/${referralId}/contact-action?action=${normalizedAction}${tokenQuery}`;
};

export const verifyContactActionToken = (
  referralId: string,
  token: string | null
): boolean => {
  const expected = buildContactActionToken(referralId);
  if (!expected || !token) return false;

  try {
    const encoder = new TextEncoder();
    const expectedBytes = encoder.encode(expected);
    const tokenBytes = encoder.encode(token);

    if (expectedBytes.length !== tokenBytes.length) return false;

    return timingSafeEqual(expectedBytes, tokenBytes);
  } catch (error) {
    console.error('Failed to verify contact action token', error);
    return false;
  }
};

export const buildPaymentActionToken = (paymentId: string): string | null => {
  if (!CONTACT_ACTION_SECRET) return null; // Reuse same secret

  const hmac = createHmac('sha256', CONTACT_ACTION_SECRET);
  hmac.update(paymentId);
  return hmac.digest('hex');
};

export const buildPaymentActionLink = (paymentId: string): string => {
  const baseUrl = getReferralAppBaseUrl();
  const token = buildPaymentActionToken(paymentId);
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${baseUrl}/api/payments/${paymentId}/mark-payment-sent${tokenQuery}`;
};

export const verifyPaymentActionToken = (
  paymentId: string,
  token: string | null
): boolean => {
  const expected = buildPaymentActionToken(paymentId);
  if (!expected || !token) return false;

  try {
    const encoder = new TextEncoder();
    const expectedBytes = encoder.encode(expected);
    const tokenBytes = encoder.encode(token);

    if (expectedBytes.length !== tokenBytes.length) return false;

    return timingSafeEqual(expectedBytes, tokenBytes);
  } catch (error) {
    console.error('Failed to verify payment action token', error);
    return false;
  }
};
