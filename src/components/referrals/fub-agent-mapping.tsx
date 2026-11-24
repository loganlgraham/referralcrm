'use client';

import { useState } from 'react';
import { toast } from 'sonner';

export function FubAgentMapping({
  referralId,
  agentId,
  agentName,
}: {
  referralId: string;
  agentId: string;
  agentName: string;
}) {
  const [users, setUsers] = useState<Array<{ id: number; name: string }>>([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/referrals/${referralId}/fub-send?agents=1`,
        { cache: 'no-store' },
      );
      const body = await res.json();
      if (!res.ok || !Array.isArray(body.users))
        throw new Error(body.error || 'Could not load the agent directory.');
      setUsers(body.users);
      setChoice('');
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Could not load the agent directory.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/referrals/${referralId}/intelligence`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentFubUserId: Number(choice),
          expectedAgentId: agentId,
        }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json()).error || 'Could not save the agent link.',
        );
      setUsers([]);
      toast.success('Follow Up Boss agent linked.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save the agent link.',
      );
    } finally {
      setBusy(false);
    }
  }
  return users.length ? (
    <div className="grid gap-2 text-sm">
      <label>
        Follow Up Boss user for {agentName}
        <select
          className="mt-1 block w-full rounded border p-2"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">Select a user</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} (#{user.id})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!choice || busy}
        onClick={() => void save()}
      >
        Confirm agent link
      </button>
    </div>
  ) : (
    <button
      type="button"
      disabled={busy}
      className="text-sm underline"
      onClick={() => void open()}
    >
      Link {agentName} to Follow Up Boss
    </button>
  );
}
