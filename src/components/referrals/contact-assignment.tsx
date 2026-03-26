'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';

import { CopyButton } from '@/components/common/copy-button';
import { EmailActivityLink } from '@/components/common/email-activity-link';
import { PhoneActivityLink } from '@/components/common/phone-activity-link';

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const fetcher = async (url: string): Promise<PaginatedResponse<AssignmentOption>> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to load directory');
  }
  const data = (await response.json()) as PaginatedResponse<AssignmentOption> | AssignmentOption[];
  
  // Handle both paginated response and direct array (for backward compatibility)
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page: 1, pageSize: data.length };
  }
  
  // Return paginated response
  if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) {
    return data as PaginatedResponse<AssignmentOption>;
  }
  
  // Fallback: return empty paginated response if structure is unexpected
  console.warn('Unexpected response structure from directory endpoint:', data);
  return { items: [], total: 0, page: 1, pageSize: 0 };
};

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

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

type AssignmentType = 'agent' | 'mc';

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;

interface Props {
  referralId: string;
  type: AssignmentType;
  contact: Contact | null | undefined;
  canAssign: boolean;
  side?: 'buy' | 'sell';
  onContactChange?: (contact: Contact | null) => void;
  className?: string;
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
  side,
  onContactChange,
  className
}: Props) {
  const [open, setOpen] = useState(false);
  const [currentContact, setCurrentContact] = useState<Contact | null | undefined>(contact);
  const [selected, setSelected] = useState(contact?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionReason, setSuggestionReason] = useState<string | null>(null);
  const [suggestedAgentIds, setSuggestedAgentIds] = useState<string[]>([]);

  const apiUrl = open && canAssign ? `${directoryForType[type]}?all=true&minimal=true` : null;
  const { data: response } = useSWR<PaginatedResponse<AssignmentOption>>(apiUrl, fetcher);
  const { mutate } = useSWRConfig();
  
  const options = response?.items ?? [];

  const title = useMemo(() => {
    if (type !== 'agent') return labelForType[type];
    if (side === 'sell') return 'Sell-side Agent';
    if (side === 'buy') return 'Buy-side Agent';
    return labelForType[type];
  }, [side, type]);

  useEffect(() => {
    setCurrentContact(contact);
    setSelected(contact?.id ?? '');
    setSearchTerm('');
    setSuggestionReason(null);
    setSuggestedAgentIds([]);
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

  const filteredOptions = useMemo(() => {
    if (!Array.isArray(options) || options.length === 0) return [];
    const query = searchTerm.trim().toLowerCase();
    let filtered = options;
    if (query) {
      filtered = options.filter((option) => {
        const name = option.name?.toLowerCase() ?? '';
        const email = option.email?.toLowerCase() ?? '';
        return name.includes(query) || email.includes(query);
      });
    }
    // Sort alphabetically by name
    return [...filtered].sort((a, b) => {
      const nameA = (a.name ?? '').toLowerCase();
      const nameB = (b.name ?? '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [options, searchTerm]);

  const handleSuggest = async () => {
    if (type !== 'agent') return;
    setSuggesting(true);
    setSuggestionReason(null);
    try {
      const params = new URLSearchParams();
      suggestedAgentIds.forEach((id) => params.append('exclude', id));
      const response = await fetch(
        `/api/referrals/${referralId}/suggest-agent${params.toString() ? `?${params.toString()}` : ''}`
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload?.error === 'string' ? payload.error : 'Unable to suggest an agent right now.';
        throw new Error(message);
      }

      const suggestion = (await response.json()) as { agentId: string; reason?: string; name?: string };
      setSelected(suggestion.agentId);
      setSuggestionReason(suggestion.reason ?? null);
      setSuggestedAgentIds((previous) => [...previous, suggestion.agentId]);
      setSearchTerm('');
      toast.success(`Suggested ${suggestion.name ?? 'agent'} selected`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to suggest an agent right now.');
    } finally {
      setSuggesting(false);
    }
  };

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
        body: JSON.stringify(
          side && type === 'agent'
            ? { [payloadKey]: selected, side }
            : { [payloadKey]: selected }
        )
      });
      if (!response.ok) {
        throw new Error('Unable to update assignment');
      }
      let nextContact: Contact | null = null;
      if (Array.isArray(options) && options.length > 0) {
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
      void mutate(`/api/referrals/${referralId}/activities`);
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
    <div className={className ? `h-full ${className}` : 'h-full'}>
      <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white px-3 py-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase text-slate-400">{title}</p>
            {formattedContact ? (
              <div className="space-y-0">
                <div className="flex items-center gap-1">
                  {currentContact?.id ? (
                    <Link
                      href={type === 'agent' ? `/agents/${currentContact.id}` : `/lenders/${currentContact.id}`}
                      className="truncate font-medium text-brand hover:underline"
                    >
                      {formattedContact.name}
                    </Link>
                  ) : (
                    <p className="truncate font-medium text-slate-900">{formattedContact.name}</p>
                  )}
                  <CopyButton value={formattedContact.name} label="Copy name" />
                </div>
                {formattedContact.email && (
                  <p className="truncate text-xs text-slate-500">
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
                    <CopyButton value={formattedContact.email} label="Copy email" className="ml-1" />
                  </p>
                )}
                {formattedContact.phone && (
                  <p className="truncate text-xs text-slate-500">
                    Phone:{' '}
                    <PhoneActivityLink
                      referralId={referralId}
                      phone={formattedContact.phone}
                      recipient={title}
                      recipientName={formattedContact.name}
                      className="text-xs"
                    >
                      {formattedContact.phone}
                    </PhoneActivityLink>
                    <CopyButton value={formattedContact.phone} label="Copy phone" className="ml-1" />
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
              className="ml-auto shrink-0 rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              {open ? 'Cancel' : formattedContact ? 'Reassign' : 'Assign'}
            </button>
          )}
        </div>
        {open && canAssign && (
          <form onSubmit={handleSubmit} className="mt-3 space-y-3">
            <label className="block text-xs font-semibold uppercase text-slate-500">
              Select {title}
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                placeholder={`Type to filter ${title.toLowerCase()}s…`}
                disabled={!Array.isArray(options) || options.length === 0 || submitting}
              />
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                disabled={!Array.isArray(options) || options.length === 0 || submitting}
              >
                <option value="">Choose…</option>
                {filteredOptions.map((option) => (
                  <option key={option._id} value={option._id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            {type === 'agent' && (
              <div className="flex flex-col gap-2 rounded border border-dashed border-slate-200 p-3 text-xs text-slate-600">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-semibold text-slate-700">Need a recommendation?</p>
                  <button
                    type="button"
                    onClick={handleSuggest}
                    disabled={suggesting}
                    className="inline-flex items-center justify-center rounded bg-slate-800 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {suggesting ? 'Thinking…' : 'Suggest agent'}
                  </button>
                </div>
                {suggestionReason && (
                  <p className="rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-700">Why:</span> {suggestionReason}
                  </p>
                )}
              </div>
            )}
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
