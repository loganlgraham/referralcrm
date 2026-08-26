import '@/app/globals.css';
import { Metadata } from 'next';
import { IBM_Plex_Mono, Manrope } from 'next/font/google';
import { CSSProperties, ReactNode, Suspense } from 'react';
import { Toaster } from 'sonner';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { NavigationProgress } from '@/components/layout/navigation-progress';
import { NextAuthProvider } from '@/components/providers/next-auth-provider';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700', '800']
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600']
});

export const metadata: Metadata = {
  title: 'Referrio',
  description: 'The handoff workspace for the AFC and AHA referral network',
  metadataBase: new URL('https://referrio.app')
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${ibmPlexMono.variable}`}
      style={{ '--font-manrope': 'var(--font-sans)' } as CSSProperties}
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-16.png" type="image/png" sizes="16x16" />
        <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon-180.png" sizes="180x180" />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body className="min-h-screen bg-surface-muted text-foreground antialiased">
        <Suspense
          fallback={(
            <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden top-progress-track" aria-hidden>
              <div className="top-progress-bar top-progress-animate h-full w-2/5" />
            </div>
          )}
        >
          <NavigationProgress />
        </Suspense>
        <Toaster
          position="top-right"
          closeButton
          theme="light"
          toastOptions={{
            classNames: {
              toast:
                'group rounded-card border border-border bg-surface-raised text-sm text-foreground shadow-raised',
              title: 'text-sm font-medium text-foreground',
              description: 'text-xs text-foreground-muted',
              actionButton:
                'bg-primary text-white hover:bg-primary-hover rounded-md px-3 py-1 text-xs font-semibold',
              cancelButton:
                'bg-surface-muted text-foreground-muted hover:bg-surface-subtle rounded-md px-3 py-1 text-xs font-semibold',
              closeButton:
                'bg-surface-raised text-foreground-subtle hover:text-foreground border border-border',
              success: 'border-success/40',
              error: 'border-danger/40',
              warning: 'border-warning/40',
              info: 'border-info/40'
            }
          }}
        />
        <NextAuthProvider>
          {children}
        </NextAuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
