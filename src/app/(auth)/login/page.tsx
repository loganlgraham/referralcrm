'use client';

export const dynamic = 'force-dynamic';

import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useState } from 'react';
import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function ErrorAlert() {
  const params = useSearchParams();
  const error = params.get('error');
  if (!error) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      Authentication error: <b>{error}</b>. See <a className="underline" href="/api/auth/providers">available providers</a>.
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
      const result = await signIn('google', { callbackUrl: '/', redirect: false });

      if (!result) {
        console.error('Login signIn returned no result', { provider: 'google' });
        setLocalError({
          summary: 'No response returned from signIn. Check network availability and NextAuth configuration.',
          details: { provider: 'google' },
        });
        return;
      }

      if (result.error) {
        console.error('Login signIn rejected by NextAuth', result);
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
        return;
      }

      if (result.url) {
        try {
          const target = new URL(result.url, window.location.origin);
          const errorCode = target.searchParams.get('error');

          if (errorCode || target.pathname.startsWith('/api/auth/error')) {
            console.error('Login signIn returned URL containing error information', {
              provider: 'google',
              errorCode,
              target: target.toString(),
              originalUrl: result.url,
            });

            setLocalError({
              summary: 'Sign-in redirected with an error from NextAuth. Inspect the reported code.',
              details: sanitizeDetails({
                provider: 'google',
                message: result.error,
                status: result.status,
                ok: result.ok,
                url: result.url,
                resolvedUrl: target.toString(),
                errorCode,
              }),
            });
            return;
          }

          window.location.href = target.toString();
          return;
        } catch (parseError) {
          console.error('Login signIn received unparseable redirect URL', {
            provider: 'google',
            result,
            parseError,
          });

          setLocalError({
            summary: 'Received an invalid redirect URL from sign-in. Check the console for details.',
            details: sanitizeDetails({
              provider: 'google',
              message: parseError instanceof Error ? parseError.message : String(parseError),
              status: result.status,
              ok: result.ok,
              url: result.url,
            }),
          });
          return;
        }
      }

      console.error('Login signIn completed without redirect URL', result);
      setLocalError({
        summary: 'Sign-in completed without a redirect URL. Verify the callback configuration.',
        details: sanitizeDetails({
          provider: 'google',
          status: result.status,
          ok: result.ok,
        }),
      });
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
