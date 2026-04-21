'use client';

import clsx from 'clsx';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type ProgressPhase = 'idle' | 'loading' | 'finishing';

function isInternalNavigation(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return false;
  if (anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return false;

  try {
    const url = new URL(anchor.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function isSameLocation(target?: string | URL | null) {
  if (!target) {
    return true;
  }

  try {
    const url = new URL(target.toString(), window.location.href);
    return (
      url.pathname === window.location.pathname &&
      url.search === window.location.search &&
      url.hash === window.location.hash
    );
  } catch {
    return true;
  }
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const completionTimer = useRef<NodeJS.Timeout>();
  const [phase, setPhase] = useState<ProgressPhase>('idle');

  const start = () => {
    if (completionTimer.current) {
      clearTimeout(completionTimer.current);
    }
    setPhase((current) => (current === 'idle' ? 'loading' : current));
  };

  const finish = () => {
    setPhase((current) => (current === 'idle' ? 'idle' : 'finishing'));
  };

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      // Skip clicks that don't navigate the current tab: modifier-key clicks
      // (open in new tab/window), non-left-button clicks, or clicks that have
      // already been cancelled.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a');

      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const anchorTarget = anchor.target;
      if (anchorTarget && anchorTarget !== '_self') {
        return;
      }

      if (isInternalNavigation(anchor) && !isSameLocation(anchor.href)) {
        start();
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  useEffect(() => {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    const wrapHistoryMethod = (method: typeof history.pushState) =>
      function wrapped(this: History, ...args: Parameters<typeof method>) {
        const nextUrl = args[2];
        if (!isSameLocation(nextUrl)) {
          start();
        }
        return method.apply(this, args as never);
      };

    // Note: no popstate listener. Next.js App Router updates pathname/searchParams
    // synchronously from the router cache on back/forward navigation, so the
    // pathname effect below already transitions the bar to idle. Calling start()
    // on popstate fires AFTER that transition and leaves the bar stuck.
    history.pushState = wrapHistoryMethod(originalPushState);
    history.replaceState = wrapHistoryMethod(originalReplaceState);

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  useEffect(() => {
    if (!pathname) return undefined;

    finish();
    completionTimer.current = setTimeout(() => {
      setPhase('idle');
    }, 320);

    return () => {
      if (completionTimer.current) {
        clearTimeout(completionTimer.current);
      }
    };
  }, [pathname, searchParams]);

  const isVisible = phase !== 'idle';
  const barClass = clsx(
    'top-progress-bar h-full w-2/5',
    phase === 'loading' && 'top-progress-animate',
    phase === 'finishing' && 'top-progress-finish'
  );

  return (
    <div
      className={clsx(
        'pointer-events-none fixed inset-x-0 top-0 z-50 transition-opacity duration-200',
        isVisible ? 'opacity-100' : 'opacity-0'
      )}
      aria-live="polite"
      aria-hidden={!isVisible}
    >
      <div className="top-progress-track h-0.5 overflow-hidden">
        <div className={barClass} />
      </div>
    </div>
  );
}
