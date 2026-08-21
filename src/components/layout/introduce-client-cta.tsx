'use client';

import Link from 'next/link';
import { Send } from 'lucide-react';

export function IntroduceClientCta({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/referrals/new"
      onClick={onNavigate}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-signal px-4 py-3 text-sm font-semibold text-white no-underline shadow-sm transition hover:bg-signal-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <Send className="h-4 w-4" aria-hidden />
      Introduce a client to AFC
    </Link>
  );
}
