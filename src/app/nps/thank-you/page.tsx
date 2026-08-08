'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ThankYouContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get('type');

  const message = type === 'lender'
    ? 'Thank you for your feedback about American Financing!'
    : 'Thank you for your feedback about the agent!';

  const showButton = type === 'lender'; // Only show button for lender surveys (agents have accounts)

  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-surface-subtle px-4 py-12">
      <div className="w-full max-w-xl rounded-card bg-surface-raised p-8 shadow-lg ring-1 ring-border">
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft">
            <svg
              className="h-6 w-6 text-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Thank You!</h1>
          <p className="text-sm text-foreground-muted">{message}</p>
          <p className="text-sm text-foreground-muted">Your response helps us improve our service.</p>
          {showButton && (
            <div className="pt-4">
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover"
              >
                Return to home
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ThankYouPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-[60vh] items-center justify-center bg-surface-subtle px-4 py-12">
        <div className="w-full max-w-xl rounded-card bg-surface-raised p-8 shadow-lg ring-1 ring-border">
          <p className="text-center text-foreground-muted">Loading...</p>
        </div>
      </main>
    }>
      <ThankYouContent />
    </Suspense>
  );
}

