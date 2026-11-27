'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2Icon } from 'lucide-react';

import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/cn';

interface SearchInputProps extends Omit<InputProps, 'value' | 'defaultValue' | 'onChange'> {
  /** Client lists already fetch their results from the URL through SWR. */
  navigation?: 'server' | 'client';
  isLoading?: boolean;
  onPendingChange?: (pending: boolean) => void;
}

/** Keep keystrokes local so typing does not rerender the surrounding table. */
export function SearchInput({
  navigation = 'server',
  isLoading = false,
  onPendingChange,
  className,
  onCompositionStart,
  onCompositionEnd,
  onKeyDown,
  ...props
}: SearchInputProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const [draft, setDraft] = useState(search);
  const [isPending, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composingRef = useRef(false);
  const submittedSearchesRef = useRef(new Set<string>());
  const latestSubmissionRef = useRef<string | null>(null);

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  const cancelScheduledSearch = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    // A slow response to an earlier search must not replace newer typing.
    if (submittedSearchesRef.current.has(search)) {
      submittedSearchesRef.current.delete(search);
      if (latestSubmissionRef.current === search) {
        submittedSearchesRef.current.clear();
        latestSubmissionRef.current = null;
      }
      return;
    }

    cancelScheduledSearch();
    submittedSearchesRef.current.clear();
    latestSubmissionRef.current = null;
    // External navigation resets the draft; our own URL acknowledgments above
    // deliberately leave it alone so slow responses cannot overwrite typing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(search);
  }, [search, pathname, cancelScheduledSearch]);

  useEffect(() => {
    const restoreFromHistory = () => {
      cancelScheduledSearch();
      submittedSearchesRef.current.clear();
      latestSubmissionRef.current = null;
      setDraft(new URLSearchParams(window.location.search).get('search') ?? '');
    };

    window.addEventListener('popstate', restoreFromHistory);
    return () => {
      cancelScheduledSearch();
      window.removeEventListener('popstate', restoreFromHistory);
    };
  }, [cancelScheduledSearch]);

  const submitSearch = useCallback((value: string) => {
    cancelScheduledSearch();
    // A queued search should never navigate back after leaving this page.
    if (window.location.pathname !== pathname) return;

    const nextSearch = value.trim();
    const params = new URLSearchParams(window.location.search);
    const currentSearch = (params.get('search') ?? '').trim();
    if (latestSubmissionRef.current === nextSearch) return;
    if (currentSearch === nextSearch && latestSubmissionRef.current === null) return;

    if (nextSearch) params.set('search', nextSearch);
    else params.delete('search');
    params.delete('page');

    const query = params.toString();
    const url = `${pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    submittedSearchesRef.current.add(nextSearch);
    latestSubmissionRef.current = nextSearch;

    startTransition(() => {
      if (navigation === 'client') {
        // Next integrates native history changes with useSearchParams without
        // requesting a server-rendered page before the list's API request.
        window.history.replaceState(null, '', url);
      } else {
        router.replace(url, { scroll: false });
      }
    });
  }, [cancelScheduledSearch, navigation, pathname, router]);

  const scheduleSearch = (value: string) => {
    cancelScheduledSearch();
    if (composingRef.current) return;
    timeoutRef.current = setTimeout(() => submitSearch(value), 300);
  };

  const updating = isLoading || isPending;

  return (
    <span className="relative block">
      <Input
        {...props}
        type={props.type ?? 'text'}
        className={cn('pr-10', className)}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          scheduleSearch(event.target.value);
        }}
        onCompositionStart={(event) => {
          composingRef.current = true;
          cancelScheduledSearch();
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          setDraft(event.currentTarget.value);
          scheduleSearch(event.currentTarget.value);
          onCompositionEnd?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== 'Enter' || composingRef.current || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submitSearch(event.currentTarget.value);
        }}
      />
      {updating && (
        <span role="status" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-foreground-subtle">
          <Loader2Icon className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          <span className="sr-only">Updating results…</span>
        </span>
      )}
    </span>
  );
}
