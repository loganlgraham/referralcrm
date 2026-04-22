import { type ReactNode } from 'react';

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
 * Two-pane authentication shell — warm amber hero on the left, content on the right.
 * Shared across /login, /signup, /reset-password, /check-email, and /onboarding.
 */
export function AuthShell({ hero, children, wide = false }: AuthShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted lg:flex-row">
      {hero && (
        <div className="relative isolate hidden w-full flex-col justify-between overflow-hidden p-12 text-white lg:flex lg:max-w-xl xl:max-w-2xl">
          <div
            aria-hidden
            className="absolute inset-0 -z-20 bg-gradient-to-br from-primary-700 via-primary-600 to-primary-800"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.22),transparent_55%),radial-gradient(circle_at_bottom_left,rgba(0,0,0,0.25),transparent_55%)]"
          />
          <div className="space-y-6">
            {hero.eyebrow && (
              <p className="text-eyebrow text-white/80">{hero.eyebrow}</p>
            )}
            <h2 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
              {hero.title}
            </h2>
            {hero.description && (
              <p className="max-w-md text-sm text-white/85">{hero.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-white/80">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-raised/10 text-base font-bold backdrop-blur">
              R
            </span>
            <div className="space-y-0.5">
              <p className="font-semibold text-white">Referrio</p>
              <p className="text-xs text-white/70">Built for the AFC &amp; AHA network.</p>
            </div>
            {hero.footer && <div className="ml-auto">{hero.footer}</div>}
          </div>
        </div>
      )}
      <div className="flex w-full flex-1 flex-col items-center justify-center px-6 py-10 sm:px-10 sm:py-14 lg:px-12">
        <div
          className={`relative w-full ${wide ? 'max-w-xl' : 'max-w-md'} space-y-6 rounded-card border border-border bg-surface-raised p-6 shadow-raised sm:p-8`}
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
    <div className="space-y-2 text-center">
      {eyebrow && <p className="text-eyebrow text-primary-700">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
      {description && <p className="text-sm text-foreground-muted">{description}</p>}
    </div>
  );
}
