'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  openPromptToast,
  PromptToastCard,
  promptToastHintClasses,
} from '@/components/referrals/prompt-toast-shell';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NoteCcAdmin {
  name?: string | null;
  email?: string | null;
}

export interface NoteCcAdminPill {
  email: string;
  label: string;
}

/** `null` means the person skipped or dismissed the toast, so the previous list stays. */
export type NoteCcToastResult = string[] | null;

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmailAddress(value));
}

export function formatEmailList(emails: string[]): string {
  if (emails.length === 0) {
    return '';
  }
  if (emails.length === 1) {
    return emails[0];
  }
  if (emails.length === 2) {
    return `${emails[0]} and ${emails[1]}`;
  }
  return `${emails.slice(0, -1).join(', ')}, and ${emails[emails.length - 1]}`;
}

export function adminPillsFromContacts(admins: NoteCcAdmin[]): NoteCcAdminPill[] {
  const pills: NoteCcAdminPill[] = [];
  const seen = new Set<string>();

  for (const admin of admins) {
    const email = typeof admin.email === 'string' ? normalizeEmailAddress(admin.email) : '';
    if (!email || !isEmailAddress(email) || seen.has(email)) {
      continue;
    }
    seen.add(email);
    const name = typeof admin.name === 'string' ? admin.name.trim() : '';
    pills.push({
      email,
      label: name ? `${name} · ${email}` : email,
    });
  }

  return pills;
}

function commitDraft(draft: string, selected: string[]): { next: string[]; invalid: boolean } {
  const parts = draft
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return { next: selected, invalid: false };
  }

  const next = [...selected];
  const seen = new Set(next);
  let invalid = false;

  for (const part of parts) {
    const normalized = normalizeEmailAddress(part);
    if (!isEmailAddress(normalized)) {
      invalid = true;
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      next.push(normalized);
    }
  }

  return { next, invalid };
}

export function NoteCcForm({
  description,
  admins,
  initialEmails,
  onCancel,
  onConfirm,
}: {
  description: string;
  admins: NoteCcAdmin[];
  initialEmails: string[];
  onCancel: () => void;
  onConfirm: (emails: string[]) => void;
}) {
  const pills = adminPillsFromContacts(admins);
  const [selected, setSelected] = useState<string[]>(() =>
    initialEmails.map((email) => normalizeEmailAddress(email)).filter((email) => isEmailAddress(email))
  );
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const toggleEmail = (email: string) => {
    setSelected((current) =>
      current.includes(email) ? current.filter((entry) => entry !== email) : [...current, email]
    );
    setError('');
  };

  const addDraft = () => {
    const { next, invalid } = commitDraft(draft, selected);
    if (invalid) {
      setError('Enter a valid email address.');
      setSelected(next);
      setDraft('');
      return false;
    }
    setSelected(next);
    setDraft('');
    setError('');
    return true;
  };

  const handleSubmit = () => {
    if (draft.trim()) {
      const { next, invalid } = commitDraft(draft, selected);
      if (invalid) {
        setSelected(next);
        setDraft('');
        setError('Enter a valid email address.');
        return;
      }
      onConfirm(next);
      return;
    }
    onConfirm(selected);
  };

  return (
    <PromptToastCard
      title="Copy anyone else?"
      description={description}
      width="wide"
      submitLabel="Add copies"
      cancelLabel="Skip"
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      {pills.length > 0 ? (
        <div>
          <p className="text-sm font-medium text-foreground">Admins</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pills.map((pill) => {
              const active = selected.includes(pill.email);
              return (
                <button
                  key={pill.email}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleEmail(pill.email)}
                  className={`rounded-full px-2.5 py-1 text-left text-xs font-medium transition ${
                    active
                      ? 'bg-primary text-white'
                      : 'bg-surface-muted text-foreground-muted hover:bg-surface-subtle'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-sm font-medium text-foreground">CC</p>
        {selected.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {selected.map((email) => (
              <li key={email}>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-subtle py-0.5 pl-2.5 pr-1 text-xs text-foreground">
                  {email}
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    onClick={() => toggleEmail(email)}
                    className="rounded-full p-0.5 text-foreground-subtle hover:bg-surface-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1.5">
          <Input
            value={draft}
            onChange={(event) => {
              const value = event.target.value;
              if (/[,;]/.test(value)) {
                const { next, invalid } = commitDraft(value, selected);
                setSelected(next);
                setDraft('');
                setError(invalid ? 'Enter a valid email address.' : '');
                return;
              }
              setDraft(value);
              if (error) {
                setError('');
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addDraft();
              }
            }}
            placeholder="name@email.com"
            autoComplete="off"
            aria-label="CC email"
            invalid={Boolean(error)}
          />
        </div>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <p className={promptToastHintClasses}>Add more than one address. Press Enter or type a comma between them.</p>
    </PromptToastCard>
  );
}

export function openNoteCcToast(options: {
  description: string;
  admins: NoteCcAdmin[];
  initialEmails: string[];
}): Promise<NoteCcToastResult> {
  return openPromptToast<NoteCcToastResult>(
    (finalize) => (
      <NoteCcForm
        description={options.description}
        admins={options.admins}
        initialEmails={options.initialEmails}
        onCancel={() => finalize(null)}
        onConfirm={finalize}
      />
    ),
    null
  );
}
