const FALLBACK_APP_BASE_URL = 'https://referrio.app';

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

export const buildContactActionLink = (referralId: string, action: string): string => {
  const baseUrl = getReferralAppBaseUrl();
  const normalizedAction = encodeURIComponent(action);
  return `${baseUrl}/api/referrals/${referralId}/contact-action?action=${normalizedAction}`;
};
