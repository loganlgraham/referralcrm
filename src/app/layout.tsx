import '@/app/globals.css';
import { Metadata } from 'next';
import { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { Inter } from 'next/font/google';
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
      <body className="min-h-screen bg-slate-100 text-slate-900">
        <Toaster position="top-right" richColors closeButton />
        <NextAuthProvider>
          {children}
        </NextAuthProvider>
      </body>
    </html>
  );
}
