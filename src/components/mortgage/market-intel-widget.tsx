'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
  SendIcon,
  ShareIcon,
  SparklesIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { FieldGroup } from './fields';

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

function CopyButton({ text, label }: { text: string; label: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      leadingIcon={<ClipboardIcon className="h-3.5 w-3.5" />}
      onClick={handleCopy}
    >
      {label}
    </Button>
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
        toast.success('Email copied');
      } else {
        setEmailError('Could not generate the email. Try again.');
      }
    } catch {
      setEmailError('Could not generate the email. Try again.');
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
        toast.success('Social post ready');
      } else {
        setPostError('Could not generate the post. Try again.');
      }
    } catch {
      setPostError('Could not generate the post. Try again.');
    } finally {
      setPostLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mortgage coach"
        title="Mortgage market"
        description="Today's national rate picture and talking points so you can set expectations before handing a client to AFC."
        actions={
          <div className="flex items-center gap-3">
            {lastUpdated ? (
              <span className="route-label text-foreground-subtle">Updated {lastUpdated}</span>
            ) : null}
            <Button
              variant="secondary"
              leadingIcon={<RotateCcwIcon className="h-4 w-4" />}
              onClick={loadAll}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-5">
        <FieldGroup title="Today's brief" className="lg:col-span-3">
          {briefLoading ? (
            <div className="space-y-2.5">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/6" />
            </div>
          ) : brief ? (
            <p className="text-[17px] leading-8 tracking-[-0.015em] text-foreground">{brief}</p>
          ) : (
            <p className="text-sm text-foreground-subtle">
              Market brief unavailable. Refresh to try again.
            </p>
          )}
        </FieldGroup>

        <section className="rounded-card border border-border bg-surface-raised p-4 shadow-card lg:col-span-2">
          <h3 className="flex items-center gap-2 text-eyebrow text-foreground-subtle">
            <SparklesIcon className="h-3.5 w-3.5 text-signal" aria-hidden />
            Talking points
          </h3>
          {talkingPointsLoading ? (
            <div className="mt-2 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5 py-2">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-5/6" />
                </div>
              ))}
            </div>
          ) : talkingPoints.length > 0 ? (
            <ul className="mt-2 divide-y divide-border">
              {talkingPoints.map((point) => (
                <li key={point} className="py-2 text-sm leading-5 text-foreground-muted last:pb-0">
                  {point}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-foreground-subtle">
              Talking points unavailable. Refresh to try again.
            </p>
          )}
        </section>
      </div>

      <FieldGroup
        title="Live national rates"
        action={
          <a
            href="https://www.mortgagenewsdaily.com/mortgage-rates"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted no-underline hover:text-foreground"
          >
            Mortgage News Daily
            <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
          </a>
        }
      >
        <div className="scrollbar-thin overflow-x-auto rounded-lg bg-surface-muted p-3">
          <div className="mx-auto w-[720px] overflow-hidden rounded-md bg-surface-raised ring-1 ring-border">
            <iframe
              title="Live national mortgage rates"
              src="//widgets.mortgagenewsdaily.com/widget/f/rates?t=large&sn=true&c=0f172a&u=&cbu=&w=720&h=290"
              width="720"
              height="290"
              scrolling="no"
              className="block h-[290px] w-[720px] border-0"
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-foreground-subtle">
          Figures are for coaching context. Defer exact quotes to the lender you are working with.
        </p>
      </FieldGroup>

      <FieldGroup title="Latest news">
        {articlesLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between gap-6">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : articles.length > 0 ? (
          <ul className="scrollbar-thin max-h-72 divide-y divide-border overflow-y-auto">
            {articles.map((article) => (
              <li key={article.link}>
                <a
                  href={article.link}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-baseline justify-between gap-6 py-2.5 no-underline"
                >
                  <span className="text-sm font-medium text-foreground group-hover:text-primary-hover">
                    {article.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground-subtle">
                    {article.source}
                    {article.pubDate ? ` · ${relativeTime(article.pubDate)}` : ''}
                    <ExternalLinkIcon
                      className="h-3.5 w-3.5 group-hover:text-primary-hover"
                      aria-hidden
                    />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground-subtle">
            No news articles available. Refresh to try again.
          </p>
        )}
      </FieldGroup>

      <FieldGroup title="Client copy">
        <div className="flex flex-wrap gap-2">
          <Button
            leadingIcon={<SendIcon className="h-4 w-4" />}
            loading={emailLoading}
            onClick={handleGenerateEmail}
          >
            Copy client email
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<ShareIcon className="h-4 w-4" />}
            loading={postLoading}
            onClick={handleGeneratePost}
          >
            Generate social post
          </Button>
        </div>

        {emailError ? <p className="mt-3 text-xs text-danger">{emailError}</p> : null}

        {emailResult ? (
          <div className="mt-4 rounded-lg bg-surface-muted p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-eyebrow text-foreground-subtle">Email preview</p>
              <CopyButton
                text={`Subject: ${emailResult.subject}\n\n${emailResult.body}`}
                label="Copy email"
              />
            </div>
            <p className="text-sm font-medium text-foreground">Subject: {emailResult.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground-muted">
              {emailResult.body}
            </p>
          </div>
        ) : null}

        {postOpen ? (
          <div className="mt-4 rounded-lg bg-surface-muted p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-eyebrow text-foreground-subtle">Social post</p>
              {postResult ? <CopyButton text={postResult} label="Copy post" /> : null}
            </div>
            {postLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-5/6" />
                <Skeleton className="h-3.5 w-4/6" />
              </div>
            ) : null}
            {postError ? <p className="text-xs text-danger">{postError}</p> : null}
            {postResult ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
                {postResult}
              </p>
            ) : null}
          </div>
        ) : null}
      </FieldGroup>
    </div>
  );
}
