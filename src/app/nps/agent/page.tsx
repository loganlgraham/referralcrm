'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function NPSSurveyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [recipientName, setRecipientName] = useState<string>('');
  const [agentName, setAgentName] = useState<string>('');

  useEffect(() => {
    if (!token) {
      setError('Missing survey token');
      setLoading(false);
      setValid(false);
      return;
    }

    // Validate token and get agent name
    fetch(`/api/nps/validate?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setValid(true);
          setRecipientName(data.recipientName || '');
          if (data.agentName) {
            setAgentName(data.agentName);
          }
        } else {
          setValid(false);
          setError(data.error || 'Invalid survey link');
        }
      })
      .catch(() => {
        setValid(false);
        setError('Failed to validate survey link');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedScore === null) {
      setError('Please select a score');
      return;
    }

    if (!token) {
      setError('Missing survey token');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/nps/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, score: selectedScore }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit survey');
      }

      // Success - redirect to thank you
      router.push(`/nps/thank-you?type=agent`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit survey');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-surface-subtle px-4 py-12">
        <div className="w-full max-w-xl rounded-card bg-surface-raised p-8 shadow-lg ring-1 ring-border">
          <p className="text-center text-foreground-muted">Loading survey...</p>
        </div>
      </main>
    );
  }

  if (!valid) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-surface-subtle px-4 py-12">
        <div className="w-full max-w-xl rounded-card bg-surface-raised p-8 shadow-lg ring-1 ring-border">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold text-foreground">Survey Not Available</h1>
            <p className="text-sm text-foreground-muted">{error || 'This survey link is invalid or has expired.'}</p>
          </div>
        </div>
      </main>
    );
  }

  const firstName = recipientName.split(' ')[0] || recipientName;
  const displayAgentName = agentName || 'this agent';

  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-surface-subtle px-4 py-12">
      <div className="w-full max-w-xl rounded-card bg-surface-raised p-8 shadow-lg ring-1 ring-border">
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Net Promoter Score</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">Help us improve</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <p className="text-sm text-foreground-muted">
                Hi {firstName},
              </p>
              <p className="mt-2 text-base font-medium text-foreground">
                On a scale of 0-10, how likely are you to recommend {displayAgentName} to a client or colleague?
              </p>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-11 gap-2">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                  <label
                    key={score}
                    className={`flex cursor-pointer flex-col items-center rounded-lg border-2 p-3 transition ${
                      selectedScore === score
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-border-strong'
                    }`}
                  >
                    <input
                      type="radio"
                      name="score"
                      value={score}
                      checked={selectedScore === score}
                      onChange={() => setSelectedScore(score)}
                      className="sr-only"
                    />
                    <span className="text-lg font-semibold text-foreground">{score}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-between text-xs text-foreground-subtle">
                <span>Not at all likely</span>
                <span>Extremely likely</span>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting || selectedScore === null}
              className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function AgentNPSSurveyPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-[60vh] items-center justify-center bg-surface-subtle px-4 py-12">
        <div className="w-full max-w-xl rounded-card bg-surface-raised p-8 shadow-lg ring-1 ring-border">
          <p className="text-center text-foreground-muted">Loading survey...</p>
        </div>
      </main>
    }>
      <NPSSurveyContent />
    </Suspense>
  );
}

