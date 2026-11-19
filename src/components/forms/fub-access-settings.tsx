'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDenverDateTime } from '@/lib/intelligence/access-control';
import { FieldGroup } from '@/components/ui/field-group';

type Organization = 'AFC' | 'AHA';

type AccessPage = {
  owner: { id: string; name: string; email: string; assignedAt: string | null };
  connection: { configured: true; accountId: string; domain: string } | { configured: false };
  admins: Array<{
    id: string;
    name: string;
    email: string;
    isOwner: boolean;
    disabled: boolean;
    afc: boolean;
    aha: boolean;
  }>;
  history: Array<{
    at: string;
    actorName: string;
    targetName: string;
    organization: Organization;
    action: 'grant' | 'revoke';
    before: 'absent' | 'granted' | 'revoked';
    after: 'granted' | 'revoked';
  }>;
};

const PERMISSION = 'View FUB Intelligence';

export function FubAccessSettings() {
  const [page, setPage] = useState<AccessPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/fub-access', { cache: 'no-store' });
      if (response.status === 403) {
        setState('forbidden');
        return;
      }
      if (!response.ok) {
        setState('error');
        return;
      }
      setPage((await response.json()) as AccessPage);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeAccess(adminId: string, organization: Organization, access: boolean) {
    const key = `${adminId}:${organization}`;
    setPending(key);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/fub-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: adminId, organization, access }),
      });
      const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!response.ok) {
        setMessage(body?.error ?? 'The access change was not saved.');
        return;
      }
      setMessage(body?.message ?? 'Access saved.');
      await load();
    } catch {
      setMessage('The access change was not saved.');
    } finally {
      setPending(null);
    }
  }

  return (
    <FieldGroup
      title="FUB access"
      description="View FUB Intelligence lets an administrator see stored Follow Up Boss activity on referrals they can already open. It does not send leads, assign agents, or change Follow Up Boss records."
    >
      <div className="min-w-0 max-w-full">
        {state === 'loading' ? <p className="text-sm text-foreground-muted">Loading FUB access…</p> : null}
        {state === 'error' ? <p className="text-sm text-danger">FUB access settings could not be loaded.</p> : null}
        {state === 'forbidden' ? (
          <p className="text-sm text-foreground-muted">Only the account owner can manage Follow Up Boss access.</p>
        ) : null}
        {state === 'ready' && page ? (
          <div className="space-y-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Account owner</p>
              <p className="break-words text-sm text-foreground-muted">
                {page.owner.name}
                {page.owner.email ? ` · ${page.owner.email}` : ''}
              </p>
              {page.owner.assignedAt ? (
                <p className="text-xs text-foreground-subtle">Owner since {formatDenverDateTime(page.owner.assignedAt)}</p>
              ) : null}
            </div>
            <p className="break-words text-sm text-foreground-muted">
              {page.connection.configured
                ? `Connected to ${page.connection.domain}, account ${page.connection.accountId}.`
                : 'Follow Up Boss is not configured.'}
            </p>
            {message ? (
              <p className="break-words text-sm text-foreground" role="status">
                {message}
              </p>
            ) : null}
            <div className="space-y-3">
              {page.admins.map((admin) => (
                <article key={admin.id} className="min-w-0 rounded-lg border border-border p-3">
                  <p className="break-words text-sm font-medium text-foreground">{admin.name}</p>
                  <p className="break-all text-xs text-foreground-muted">{admin.email}</p>
                  {admin.isOwner ? <p className="mt-1 text-xs text-foreground-subtle">Account owner</p> : null}
                  {admin.disabled ? <p className="mt-1 text-xs text-foreground-subtle">Not an active administrator</p> : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <AccessToggle
                      label="AFC"
                      checked={admin.afc}
                      disabled={!page.connection.configured || admin.isOwner || admin.disabled || pending !== null}
                      pending={pending === `${admin.id}:AFC`}
                      onChange={(access) => void changeAccess(admin.id, 'AFC', access)}
                    />
                    <AccessToggle
                      label="AHA"
                      checked={admin.aha}
                      disabled={!page.connection.configured || admin.isOwner || admin.disabled || pending !== null}
                      pending={pending === `${admin.id}:AHA`}
                      onChange={(access) => void changeAccess(admin.id, 'AHA', access)}
                    />
                  </div>
                </article>
              ))}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Access changes</p>
              {page.history.length === 0 ? <p className="mt-1 text-sm text-foreground-muted">No access changes yet.</p> : null}
              <ul className="mt-2 space-y-2">
                {page.history.map((entry) => (
                  <li key={`${entry.at}:${entry.targetName}:${entry.organization}:${entry.action}`} className="break-words text-sm text-foreground-muted">
                    {formatDenverDateTime(entry.at)} · {entry.actorName} {entry.action === 'grant' ? 'granted' : 'revoked'} {PERMISSION} for {entry.targetName} on {entry.organization}. Before: {labelState(entry.before)}. After: {labelState(entry.after)}.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </FieldGroup>
  );
}

function AccessToggle({
  label,
  checked,
  disabled,
  pending,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  pending: boolean;
  onChange: (access: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-foreground-muted">{pending ? 'Saving…' : PERMISSION}</span>
      </span>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 rounded border-border-strong text-primary focus:ring-ring"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function labelState(state: 'absent' | 'granted' | 'revoked'): string {
  switch (state) {
    case 'absent':
      return 'No access';
    case 'granted':
      return 'Granted';
    case 'revoked':
      return 'Revoked';
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}
