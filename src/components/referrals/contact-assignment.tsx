'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { EmailActivityLink } from '@/components/common/email-activity-link';

const fetcher = (url: string) => fetch(url).then((response) => {
  if (!response.ok) {
    throw new Error('Failed to load directory');
  }
  return response.json();
});

export interface Contact {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface AssignmentOption {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
}

type AssignmentType = 'agent' | 'mc';

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;

interface Props {
  referralId: string;
  type: AssignmentType;
  contact: Contact | null | undefined;
  canAssign: boolean;
  onContactChange?: (contact: Contact | null) => void;
}

const directoryForType: Record<AssignmentType, string> = {
  agent: '/api/agents',
  mc: '/api/lenders'
};

const labelForType: Record<AssignmentType, string> = {
  agent: 'Agent',
  mc: 'Mortgage Consultant'
};

const payloadKeyForType: Record<AssignmentType, 'agentId' | 'lenderId'> = {
  agent: 'agentId',
  mc: 'lenderId'
};

const endpointForType: Record<AssignmentType, (id: string) => string> = {
  agent: (id: string) => `/api/referrals/${id}/assign`,
  mc: (id: string) => `/api/referrals/${id}/assign-lender`
};

export function ContactAssignment({
  referralId,
  type,
  contact,
  canAssign,
  onContactChange
}: Props) {
  const [open, setOpen] = useState(false);
  const [currentContact, setCurrentContact] = useState<Contact | null | undefined>(contact);
  const [selected, setSelected] = useState(contact?.id ?? '');
  const [submitting, setSubmitting] = useState(false);

  const { data: options } = useSWR<AssignmentOption[]>(open && canAssign ? directoryForType[type] : null, fetcher);

  const title = labelForType[type];

  useEffect(() => {
    setCurrentContact(contact);
    setSelected(contact?.id ?? '');
  }, [contact]);

  const formattedContact = useMemo(() => {
    if (!currentContact?.name) {
      return null;
    }
    return {
      name: currentContact.name,
      email: currentContact.email ?? undefined,
      phone: currentContact.phone ?? undefined
    };
  }, [currentContact]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) {
      toast.error(`Select a ${title.toLowerCase()} before saving.`);
      return;
    }
    setSubmitting(true);
    try {
      const endpoint = endpointForType[type](referralId);
      const payloadKey = payloadKeyForType[type];
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [payloadKey]: selected })
      });
      if (!response.ok) {
        throw new Error('Unable to update assignment');
      }
      let nextContact: Contact | null = null;
      if (options) {
        const match = options.find((option) => option._id === selected);
        nextContact = {
          id: selected,
          name: match?.name ?? '',
          email: match?.email ?? null,
          phone: match?.phone ?? null
        };
      } else if (currentContact && currentContact.id === selected) {
        nextContact = currentContact;
      }

      setCurrentContact(nextContact);
      onContactChange?.(nextContact);
      toast.success(`${title} assigned`);
      setOpen(false);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to assign contact');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="rounded border border-slate-200 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase text-slate-400">{title}</p>
            {formattedContact ? (
              <div>
                <p className="font-medium text-slate-900">{formattedContact.name}</p>
                {formattedContact.email && (
                  <p className="text-xs text-slate-500">
                    Email:{' '}
                    <EmailActivityLink
                      referralId={referralId}
                      email={formattedContact.email}
                      recipient={title}
                      recipientName={formattedContact.name}
                      className="text-xs"
                    >
                      {formattedContact.email}
                    </EmailActivityLink>
                  </p>
                )}
                {formattedContact.phone && (
                  <p className="text-xs text-slate-500">
                    Phone:{' '}
                    <a className="text-brand hover:underline" href={`tel:${formattedContact.phone}`}>
                      {formattedContact.phone}
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Unassigned</p>
            )}
          </div>
          {canAssign && (
            <button
              type="button"
              onClick={() => setOpen((previous) => !previous)}
              className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              {open ? 'Cancel' : formattedContact ? 'Reassign' : 'Assign'}
            </button>
          )}
        </div>
        {open && canAssign && (
          <form onSubmit={handleSubmit} className="mt-3 space-y-3">
            <label className="block text-xs font-semibold uppercase text-slate-500">
              Select {title}
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                disabled={!options || submitting}
              >
                <option value="">Choose…</option>
                {options?.map((option) => (
                  <option key={option._id} value={option._id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={submitting || !selected}
              className="inline-flex w-full items-center justify-center rounded bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
