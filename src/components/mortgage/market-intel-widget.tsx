'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircleIcon,
  CheckIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  LineChartIcon,
  Loader2Icon,
  NewspaperIcon,
  RefreshCwIcon,
  SendIcon,
  ShareIcon,
  SparklesIcon,
} from 'lucide-react';

type RssArticle = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
};

type ClientEmail = {
  subject: string;
  body: string;
};

function relativeTime(pubDate: string): string {
  if (!pubDate) return '';
  const diff = Date.now() - new Date(pubDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-subtle ${className ?? ''}`} />;
}

function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied!',
  className = '',
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        copied
          ? 'bg-success-soft text-success'
          : 'bg-surface-subtle text-foreground-muted hover:bg-surface-subtle'
      } ${className}`}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <ClipboardIcon className="h-3.5 w-3.5" />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
}

export function MarketIntelWidget() {
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);

  const [talkingPoints, setTalkingPoints] = useState<string[]>([]);
  const [talkingPointsLoading, setTalkingPointsLoading] = useState(true);

  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);

  const [emailLoading, setEmailLoading] = useState(false);
  const [emailResult, setEmailResult] = useState<ClientEmail | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [postLoading, setPostLoading] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [postOpen, setPostOpen] = useState(false);

  const [lastUpdated, setLastUpdated] = useState<string>('');

  const loadAll = useCallback(async () => {
    setBriefLoading(true);
    setTalkingPointsLoading(true);
    setArticlesLoading(true);

    const [briefRes, tpRes, newsRes] = await Promise.allSettled([
      fetch('/api/daily-market-brief').then((r) => r.json() as Promise<{ brief?: string }>),
      fetch('/api/agent-talking-points').then(
        (r) => r.json() as Promise<{ talkingPoints?: string[] }>
      ),
      fetch('/api/real-estate-news').then(
        (r) => r.json() as Promise<{ articles?: RssArticle[] }>
      ),
    ]);

    if (briefRes.status === 'fulfilled') setBrief(briefRes.value.brief ?? null);
    setBriefLoading(false);

    if (tpRes.status === 'fulfilled') setTalkingPoints(tpRes.value.talkingPoints ?? []);
    setTalkingPointsLoading(false);

    if (newsRes.status === 'fulfilled') setArticles(newsRes.value.articles ?? []);
    setArticlesLoading(false);

    setLastUpdated(
      new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    );
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleGenerateEmail = async () => {
    setEmailLoading(true);
    setEmailError(null);
    setEmailResult(null);
    try {
      const res = await fetch('/api/client-email');
      const data = (await res.json()) as { email?: ClientEmail; error?: string };
      if (data.email) {
        setEmailResult(data.email);
        const text = `Subject: ${data.email.subject}\n\n${data.email.body}`;
        await navigator.clipboard.writeText(text);
      } else {
        setEmailError('Failed to generate email. Please try again.');
      }
    } catch {
      setEmailError('Failed to generate email. Please try again.');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleGeneratePost = async () => {
    setPostLoading(true);
    setPostError(null);
    setPostResult(null);
    setPostOpen(true);
    try {
      const res = await fetch('/api/social-post');
      const data = (await res.json()) as { post?: string; error?: string };
      if (data.post) {
        setPostResult(data.post);
      } else {
        setPostError('Failed to generate post. Please try again.');
      }
    } catch {
      setPostError('Failed to generate post. Please try again.');
    } finally {
      setPostLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Live Rate Snapshot — top of page */}
      <div className="rounded-card bg-surface-raised shadow">
        <div className="px-5 pt-5">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-foreground-subtle">
            Live national mortgage rates — via Mortgage News Daily
          </p>
        </div>

        <div className="mt-3 max-w-3xl mx-auto px-4">
          <div className="overflow-hidden rounded-md border border-border shadow-sm">
            <div className="bg-primary py-1.5 text-center text-white">
              <a
                href="https://www.mortgagenewsdaily.com/mortgage-rates"
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-white no-underline hover:text-white"
              >
                Mortgage Interest Rates
              </a>
            </div>
            <div className="overflow-x-auto">
              <iframe
                src="//widgets.mortgagenewsdaily.com/widget/f/rates?t=large&sn=true&c=0f172a&u=&cbu=&w=720&h=290"
                width="720"
                height="290"
                frameBorder="0"
                scrolling="no"
                style={{
                  border: 'solid 1px hsl(var(--primary))',
                  borderWidth: '0 1px',
                  boxSizing: 'border-box',
                  minWidth: '720px',
                  width: '720px',
                  height: '290px',
                  display: 'block',
                }}
              />
            </div>
            <div className="bg-primary py-1.5 text-center text-white">
              View More{' '}
              <a
                href="https://www.mortgagenewsdaily.com/mortgage-rates"
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-white no-underline hover:text-white"
              >
                Mortgage Rates
              </a>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-3 max-w-3xl px-4 pb-5">
          <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
            <div className="flex items-center gap-1.5 font-semibold text-warning sm:shrink-0">
              <AlertCircleIcon className="h-4 w-4" />
              <span className="text-sm">Use with care</span>
            </div>
            <p className="text-sm text-warning">
              These figures are for educational context only. Always defer exact rate quotes to the
              lender you are working with.
            </p>
          </div>
        </div>
      </div>

      {/* Page header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Market Intelligence</h1>
          {lastUpdated && (
            <p className="mt-0.5 text-xs text-foreground-subtle">Last updated at {lastUpdated}</p>
          )}
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="inline-flex items-center gap-2 self-start rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm font-medium text-foreground-muted shadow-sm transition-colors hover:bg-surface-muted sm:self-auto"
        >
          <RefreshCwIcon className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Daily Market Brief */}
      <div className="rounded-card bg-surface-raised p-5 shadow">
        <div className="mb-3 flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Daily Market Brief</h2>
        </div>
        {briefLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : brief ? (
          <p className="text-sm leading-relaxed text-foreground-muted">{brief}</p>
        ) : (
          <p className="text-sm text-foreground-subtle">Market brief unavailable. Try refreshing.</p>
        )}
      </div>

      {/* Two-column: Talking Points + Latest News */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Agent Talking Points */}
        <div className="rounded-card bg-surface-raised p-5 shadow">
          <div className="mb-3 flex items-center gap-2">
            <SparklesIcon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Agent Talking Points</h2>
          </div>
          {talkingPointsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-5/6" />
                </div>
              ))}
            </div>
          ) : talkingPoints.length > 0 ? (
            <ul className="space-y-3">
              {talkingPoints.map((point, i) => (
                <li key={i} className="flex gap-3 text-sm text-foreground-muted">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{point}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-subtle">Talking points unavailable. Try refreshing.</p>
          )}
        </div>

        {/* Latest News */}
        <div className="rounded-card bg-surface-raised p-5 shadow">
          <div className="mb-3 flex items-center gap-2">
            <NewspaperIcon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Latest News</h2>
          </div>
          {articlesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : articles.length > 0 ? (
            <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {articles.map((article, i) => (
                <li key={i} className="border-b border-border pb-3 last:border-0 last:pb-0">
                  <a
                    href={article.link}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-start justify-between gap-2"
                  >
                    <span className="text-sm font-medium text-foreground group-hover:text-primary-hover">
                      {article.title}
                    </span>
                    <ExternalLinkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-subtle group-hover:text-primary-hover" />
                  </a>
                  <p className="mt-0.5 text-xs text-foreground-subtle">
                    {article.source}
                    {article.pubDate ? ` · ${relativeTime(article.pubDate)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-subtle">No news articles available. Try refreshing.</p>
          )}
        </div>
      </div>

      {/* Agent Tools: Copy Email + Social Post */}
      <div className="rounded-card bg-surface-raised p-5 shadow">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Agent Tools</h2>
        <div className="flex flex-wrap gap-3">
          {/* Copy Client Email */}
          <button
            type="button"
            onClick={handleGenerateEmail}
            disabled={emailLoading}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {emailLoading ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : emailResult ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
            {emailLoading ? 'Generating…' : emailResult ? 'Copied to Clipboard!' : 'Copy Client Email'}
          </button>

          {/* Generate Social Post */}
          <button
            type="button"
            onClick={handleGeneratePost}
            disabled={postLoading}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-foreground-muted shadow-sm transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {postLoading ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <ShareIcon className="h-4 w-4" />
            )}
            {postLoading ? 'Generating…' : 'Generate Social Post'}
          </button>
        </div>

        {emailError && (
          <p className="mt-3 text-xs text-danger">{emailError}</p>
        )}

        {emailResult && (
          <div className="mt-4 rounded-lg border border-border bg-surface-muted p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground-muted">Email Preview</p>
              <CopyButton
                text={`Subject: ${emailResult.subject}\n\n${emailResult.body}`}
                label="Copy Email"
                copiedLabel="Copied!"
              />
            </div>
            <p className="text-xs font-medium text-foreground">Subject: {emailResult.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-xs text-foreground-muted">{emailResult.body}</p>
          </div>
        )}

        {postOpen && (
          <div className="mt-4 rounded-lg border border-border bg-surface-muted p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground-muted">Social Post</p>
              {postResult && (
                <CopyButton text={postResult} label="Copy Post" copiedLabel="Copied!" />
              )}
            </div>
            {postLoading && (
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-5/6" />
                <Skeleton className="h-3.5 w-4/6" />
              </div>
            )}
            {postError && <p className="text-xs text-danger">{postError}</p>}
            {postResult && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
                {postResult}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
