import type { NextRequest } from 'next/server';

/**
 * Get the app's public origin URL for internal API calls.
 * 
 * Prefers APP_URL or NEXTAUTH_URL (production should be https://referrio.app),
 * falls back to VERCEL_URL, then request origin.
 * 
 * @param request - Optional NextRequest to extract origin from if env vars aren't set
 * @returns Normalized base URL without trailing slash
 */
export function getAppOrigin(request?: NextRequest): string {
  // For request-bound handlers (API/routes), prefer the active request host.
  // This avoids cross-environment calls in preview deployments where APP_URL/NEXTAUTH_URL
  // may still point at production.
  if (request) {
    return new URL(request.url).origin;
  }

  // Prefer APP_URL, then NEXTAUTH_URL
  const envUrl = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (envUrl) {
    const normalized = envUrl.trim().replace(/\/$/, '');
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      return normalized;
    }
    // If it doesn't start with http, assume https
    return `https://${normalized}`;
  }

  // Fallback to VERCEL_URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // Final fallback (shouldn't happen in production)
  return 'http://localhost:3000';
}
