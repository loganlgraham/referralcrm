import '@/app/globals.css';
import { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ReactNode, Suspense } from 'react';
import { Toaster } from 'sonner';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { NavigationProgress } from '@/components/layout/navigation-progress';
import { NextAuthProvider } from '@/components/providers/next-auth-provider';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Referral CRM',
  description: 'Referral routing and tracking for AFC & AHA',
  metadataBase: new URL('https://referralcrm.example.com')
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <Suspense
          fallback={(
            <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden top-progress-track" aria-hidden>
              <div className="top-progress-bar top-progress-animate h-full w-2/5" />
            </div>
          )}
        >
          <NavigationProgress />
        </Suspense>
        <Toaster position="top-right" richColors closeButton />
        <NextAuthProvider>
          {children}
        </NextAuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
