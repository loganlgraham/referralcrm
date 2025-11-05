'use client';

export const dynamic = 'force-dynamic';

import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const errorExplanations: Record<string, { title: string; description: string }> = {
  OAuthAccountNotLinked: {
    title: 'Google account is already linked to another user',
    description:
      'Sign in using the original provider you used during signup, or ask an admin to unlink the old account.',
  },
  OAuthCallback: {
    title: 'The Google OAuth callback failed to validate',
    description:
      'Double-check the Google OAuth credentials, authorized redirect URLs, and any middleware rewrites that might block the callback.',
  },
  OAuthSignin: {
    title: 'Google rejected the initial sign-in request',
    description:
      'Ensure the Google client ID/secret are correct and that third-party cookies are enabled in the browser.',
  },
  EmailSignin: {
    title: 'Email sign-in is not currently available',
    description: 'Verify email provider configuration or use Google sign-in instead.',
  },
  Configuration: {
    title: 'NextAuth configuration error',
    description: 'Review the server logs—environment variables or adapter configuration is likely invalid.',
  },
  AccessDenied: {
    title: 'Access to this application was denied',
    description: 'Confirm the user has permission to access this workspace or contact an administrator.',
  },
};

function ErrorAlert() {
  const params = useSearchParams();
  const error = params.get('error');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  if (!error) return null;

  const provider = params.get('provider') ?? 'unknown';
  const description = params.get('error_description');
  const explanation = errorExplanations[error];

  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <div>
        <p className="font-medium">Authentication error: {error}</p>
        <p className="text-xs text-red-800">
          Provider: <b>{provider}</b>
          {description ? (
            <>
              {' · '}Details: <span className="font-mono">{description}</span>
            </>
          ) : null}
        </p>
      </div>

      {explanation ? (
        <div className="rounded bg-red-100 p-2 text-xs text-red-900">
          <p className="font-semibold">{explanation.title}</p>
          <p>{explanation.description}</p>
        </div>
      ) : (
        <p className="text-xs text-red-800">
          Need more information? Inspect the network tab for <code>/api/auth/signin/google</code> and review
          the server logs for the corresponding request ID.
        </p>
      )}

      <p className="text-xs text-red-800">
        Verify configured providers via{' '}
        <a className="underline" href="/api/auth/providers">
          /api/auth/providers
        </a>{' '}
        and confirm the callback URL matches <code>{origin}</code>.
      </p>
    </div>
  );
}

type DetailedError = {
  summary: string;
  details?: Record<string, unknown>;
};

const sanitizeDetails = (details: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<DetailedError | null>(null);
  const router = useRouter();

  const handleGoogle = async () => {
    setLoading(true);
    setLocalError(null);

    try {
      const result = await signIn('google', { callbackUrl: '/', redirect: true });

      if (result?.error) {
        console.error('Login signIn rejected by NextAuth before redirect', result);
        setLocalError({
          summary: 'Sign-in request was rejected by NextAuth. Review the error details below.',
          details: sanitizeDetails({
            provider: 'google',
            message: result.error,
            status: result.status,
            ok: result.ok,
            url: result.url,
          }),
        });
      }
    } catch (error) {
      console.error('Login signIn threw an unexpected error', error);
      setLocalError({
        summary: 'Unexpected error while calling signIn. See the captured message for debugging.',
        details: sanitizeDetails({
          provider: 'google',
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEmail = () => {
    router.push('/auth/email');
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome back</h1>
          <p className="mt-2 text-sm text-gray-600">Sign in to your account</p>
        </div>

        <Suspense fallback={null}>
          <ErrorAlert />
        </Suspense>

        {localError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 space-y-2">
            <p className="font-medium">{localError.summary}</p>
            {localError.details && (
              <pre className="whitespace-pre-wrap break-words rounded bg-red-100 p-2 text-xs text-red-900">
                {JSON.stringify(localError.details, null, 2)}
              </pre>
            )}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full rounded-md bg-black px-4 py-3 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Continue with Google'}
          </button>
          
          <button
            onClick={handleEmail}
            disabled={loading}
            className="w-full rounded-md border border-gray-300 px-4 py-3 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Continue with Email'}
          </button>
        </div>

        <p className="text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <Link href="/signup" className="font-medium text-black underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
