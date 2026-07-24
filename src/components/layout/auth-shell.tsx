import { type ReactNode } from 'react';
import { BrandMark } from '@/components/ui/brand-mark';

interface AuthShellProps {
  hero?: {
    eyebrow?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    footer?: ReactNode;
  };
  children: ReactNode;
  wide?: boolean;
}

/**
 * Two-pane authentication shell built around Referrio's handoff route.
 * Shared across /login, /signup, /reset-password, /check-email, and /onboarding.
 */
export function AuthShell({ hero, children, wide = false }: AuthShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted lg:flex-row">
      {hero && (
        <div className="relative isolate hidden w-full flex-col justify-between overflow-hidden bg-[#132238] p-12 text-white lg:flex lg:max-w-xl xl:max-w-2xl">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-20 -z-10 w-px bg-white/10" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-32 -z-10 h-96 w-96 rounded-full border border-white/[0.06]" />
          <div className="space-y-8">
            <BrandMark inverted />
            <div className="space-y-5">
            {hero.eyebrow && (
              <p className="text-eyebrow text-signal">{hero.eyebrow}</p>
            )}
            <h2 className="max-w-lg font-display text-4xl font-semibold leading-[1.06] tracking-[-0.04em] xl:text-5xl">
              {hero.title}
            </h2>
            {hero.description && (
              <p className="max-w-md text-base leading-relaxed text-white/66">{hero.description}</p>
            )}
            </div>
          </div>

          <div className="relative ml-1 space-y-0">
            <p className="route-label mb-5 text-white/38">One connected handoff</p>
            {[
              ['Mortgage consultant', 'Client ready'],
              ['Referral desk', 'Match confirmed'],
              ['Trusted agent', 'Relationship active']
            ].map(([label, detail], index) => (
              <div key={label} className="relative flex min-h-16 items-start gap-4 pl-8">
                {index < 2 ? <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-white/18" /> : null}
                <span
                  aria-hidden
                  className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-[#132238] ${
                    index === 2 ? 'bg-signal' : 'bg-primary-400'
                  }`}
                />
                <div>
                  <p className="font-display text-sm font-medium text-white">{label}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-white/38">{detail}</p>
                </div>
            </div>
            ))}
            {hero.footer ? <div className="pt-2">{hero.footer}</div> : null}
          </div>
        </div>
      )}
      <div className="flex w-full flex-1 flex-col items-center justify-center px-5 py-8 sm:px-10 sm:py-14 lg:px-12">
        <div className="mb-6 lg:hidden">
          <BrandMark />
        </div>
        <div
          className={`route-surface relative w-full ${wide ? 'max-w-xl' : 'max-w-md'} space-y-6 overflow-hidden rounded-card border border-border bg-surface-raised p-6 pl-7 shadow-raised sm:p-8 sm:pl-9`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function AuthHeading({
  eyebrow,
  title,
  description
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="space-y-2 text-left">
      {eyebrow && <p className="text-eyebrow text-signal-dark">{eyebrow}</p>}
      <h1 className="font-display text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">{title}</h1>
      {description && <p className="text-sm text-foreground-muted">{description}</p>}
    </div>
  );
}
