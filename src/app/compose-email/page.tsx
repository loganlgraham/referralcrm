'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { buildGmailComposeUrl } from '@/utils/gmail';

type CopyState = 'copying' | 'copied' | 'failed';

function ComposeEmailContent() {
  const searchParams = useSearchParams();
  const to = searchParams.get('to') ?? '';
  const cc = searchParams.get('cc') ?? '';
  const subject = searchParams.get('subject') ?? '';
  const body = searchParams.get('body') ?? '';

  const [copyState, setCopyState] = useState<CopyState>('copying');

  const gmailUrl = buildGmailComposeUrl(to, { cc, subject });

  const copyBody = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }, [body]);

  // Auto-copy on mount and redirect after a short delay
  useEffect(() => {
    let redirectTimer: ReturnType<typeof setTimeout>;

    copyBody().then(() => {
      redirectTimer = setTimeout(() => {
        window.location.href = gmailUrl;
      }, 1200);
    });

    return () => clearTimeout(redirectTimer);
  }, [copyBody, gmailUrl]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
        <div className="space-y-4 text-center">
          {copyState === 'copying' && (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <svg className="h-6 w-6 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-slate-900">Preparing email…</h1>
              <p className="text-sm text-slate-600">Copying email body to clipboard.</p>
            </>
          )}

          {copyState === 'copied' && (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-slate-900">Email body copied!</h1>
              <p className="text-sm text-slate-600">
                Opening Gmail… Just paste <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs">⌘V</kbd> into the compose window.
              </p>
              <div className="pt-2">
                <a
                  href={gmailUrl}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  Open Gmail Compose
                </a>
              </div>
            </>
          )}

          {copyState === 'failed' && (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-slate-900">Couldn&apos;t auto-copy</h1>
              <p className="text-sm text-slate-600">
                Click below to copy the email body, then open Gmail to compose.
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={copyBody}
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  Copy Email Body
                </button>
                <a
                  href={gmailUrl}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  Open Gmail Compose
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ComposeEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[60vh] items-center justify-center bg-slate-100 px-4 py-12">
          <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
            <p className="text-center text-slate-700">Preparing email…</p>
          </div>
        </main>
      }
    >
      <ComposeEmailContent />
    </Suspense>
  );
}
