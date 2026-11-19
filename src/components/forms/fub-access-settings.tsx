'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDenverDateTime } from '@/lib/intelligence/access-control';
import { FieldGroup, selectFieldClasses } from '@/components/ui/field-group';

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
  const [selectedAdminId, setSelectedAdminId] = useState<string>('');

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
      const data = (await response.json()) as AccessPage;
      setPage(data);
      setSelectedAdminId((current) => {
        const assignable = data.admins.filter((admin) => !admin.isOwner && !admin.disabled);
        if (current && assignable.some((admin) => admin.id === current)) return current;
        return assignable[0]?.id ?? '';
      });
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
      description="Grant selected admins read-only FUB Intelligence visibility for referrals they can already open."
    >
      <div className="min-w-0 max-w-full">
        {state === 'loading' ? <p className="text-sm text-foreground-muted">Loading FUB access…</p> : null}
        {state === 'error' ? <p className="text-sm text-danger">FUB access settings could not be loaded.</p> : null}
        {state === 'forbidden' ? (
          <p className="text-sm text-foreground-muted">Only the account owner can manage Follow Up Boss access.</p>
        ) : null}
        {state === 'ready' && page ? (
          <FubAccessControls page={page} selectedAdminId={selectedAdminId} setSelectedAdminId={setSelectedAdminId} pending={pending} message={message} changeAccess={changeAccess} />
        ) : null}
      </div>
    </FieldGroup>
  );
}

function FubAccessControls({
  page,
  selectedAdminId,
  setSelectedAdminId,
  pending,
  message,
  changeAccess,
}: {
  page: AccessPage;
  selectedAdminId: string;
  setSelectedAdminId: (id: string) => void;
  pending: string | null;
  message: string | null;
  changeAccess: (adminId: string, organization: Organization, access: boolean) => Promise<void>;
}) {
  const assignableAdmins = useMemo(() => page.admins.filter((admin) => !admin.isOwner && !admin.disabled), [page.admins]);
  const selectedAdmin = assignableAdmins.find((admin) => admin.id === selectedAdminId) ?? assignableAdmins[0] ?? null;
  const grantedCount = assignableAdmins.filter((admin) => admin.afc || admin.aha).length;
  const history = page.history.slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm text-foreground-muted sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background-subtle p-3">
          <p className="font-medium text-foreground">Owner</p>
          <p className="mt-1 break-words">{page.owner.name}</p>
        </div>
        <div className="rounded-lg border border-border bg-background-subtle p-3">
          <p className="font-medium text-foreground">FUB account</p>
          <p className="mt-1 break-words">
            {page.connection.configured ? `${page.connection.domain} (${page.connection.accountId})` : 'Not configured'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border p-3">
        <label className="block text-sm font-medium text-foreground" htmlFor="fub-admin-select">
          Admin
        </label>
        <select
          id="fub-admin-select"
          className={`${selectFieldClasses} mt-2`}
          value={selectedAdmin?.id ?? ''}
          onChange={(event) => setSelectedAdminId(event.target.value)}
          disabled={assignableAdmins.length === 0 || pending !== null}
        >
          {assignableAdmins.length === 0 ? <option value="">No eligible admins</option> : null}
          {assignableAdmins.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.name} ({admin.email})
            </option>
          ))}
        </select>

        {selectedAdmin ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <AccessToggle
              label="AFC"
              checked={selectedAdmin.afc}
              disabled={!page.connection.configured || pending !== null}
              pending={pending === `${selectedAdmin.id}:AFC`}
              onChange={(access) => void changeAccess(selectedAdmin.id, 'AFC', access)}
            />
            <AccessToggle
              label="AHA"
              checked={selectedAdmin.aha}
              disabled={!page.connection.configured || pending !== null}
              pending={pending === `${selectedAdmin.id}:AHA`}
              onChange={(access) => void changeAccess(selectedAdmin.id, 'AHA', access)}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-foreground-muted">Add an active admin before granting FUB visibility.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-foreground-muted">
          {grantedCount} admin{grantedCount === 1 ? '' : 's'} with FUB visibility
        </p>
        {message ? (
          <p className="text-foreground" role="status">
            {message}
          </p>
        ) : null}
      </div>

      {history.length > 0 ? (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Recent changes</summary>
          <ul className="mt-2 space-y-1">
            {history.map((entry) => (
              <li key={`${entry.at}:${entry.targetName}:${entry.organization}:${entry.action}`} className="break-words text-sm text-foreground-muted">
                {formatDenverDateTime(entry.at)} · {entry.organization} {entry.action === 'grant' ? 'granted' : 'revoked'} for {entry.targetName}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
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
