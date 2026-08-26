import { ReferrioIcon } from './ReferrioIcon';
import { ReferrioWordmark } from './ReferrioWordmark';

/**
 * The lockup at the head of the sign-in page: icon tile, wordmark, descriptor.
 * Drop-in replacement for the placeholder mark in src/app/(auth)/login/page.tsx.
 */
export function AuthBrandLockup({ descriptor = 'Handoff Desk' }: { descriptor?: string }) {
  return (
    <div className="flex items-center justify-center gap-4">
      <ReferrioIcon size={56} />
      <div className="flex flex-col gap-1">
        <ReferrioWordmark size={28} bg="#F1F5F9" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground-subtle">
          {descriptor}
        </span>
      </div>
    </div>
  );
}
