'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';

import { ContactLine } from '@/components/common/contact-line';
import { CopyButton } from '@/components/common/copy-button';
import { Button } from '@/components/ui/button';
import { selectFieldClasses } from '@/components/ui/field-group';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

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
  active?: boolean;
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
  /** Shown under the empty/pending state (e.g. agent waiting on MC pairing). */
  pendingHelper?: string;
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
  className,
  pendingHelper
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

  const selectedOption = useMemo(
    () => filteredOptions.find((option) => option._id === selected) ?? options.find((option) => option._id === selected),
    [filteredOptions, options, selected]
  );

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
      <div className="flex h-full flex-col rounded-lg bg-surface-raised px-3 py-2 shadow-sm ring-1 ring-inset ring-border">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground-subtle">{title}</p>
            {formattedContact ? (
              <div className="mt-0.5 space-y-0.5">
                <div className="flex items-center gap-1">
                  {currentContact?.id ? (
                    <Link
                      href={type === 'agent' ? `/agents/${currentContact.id}` : `/lenders/${currentContact.id}`}
                      className="text-base font-semibold text-primary break-words hover:underline"
                    >
                      {formattedContact.name}
                    </Link>
                  ) : (
                    <p className="text-base font-semibold text-foreground break-words">{formattedContact.name}</p>
                  )}
                  <CopyButton value={formattedContact.name} label="Copy name" />
                </div>
                {formattedContact.email ? (
                  <ContactLine
                    kind="email"
                    value={formattedContact.email}
                    referralId={referralId}
                    recipient={title}
                    recipientName={formattedContact.name}
                  />
                ) : null}
                {formattedContact.phone ? (
                  <ContactLine
                    kind="phone"
                    value={formattedContact.phone}
                    referralId={referralId}
                    recipient={title}
                    recipientName={formattedContact.name}
                  />
                ) : null}
              </div>
            ) : (
              <div className="mt-0.5 space-y-1.5">
                <p className="text-sm font-semibold text-foreground-muted">
                  {type === 'mc' ? 'Pending' : 'Unassigned'}
                </p>
                {pendingHelper ? (
                  <p className="rounded-lg border border-primary/20 bg-primary-soft px-2 py-1.5 text-xs leading-snug text-primary">
                    {pendingHelper}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          {canAssign && (
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto shrink-0"
              onClick={() => setOpen((previous) => !previous)}
            >
              {open ? 'Cancel' : formattedContact ? 'Reassign' : 'Assign'}
            </Button>
          )}
        </div>
        {open && canAssign && (
          <form onSubmit={handleSubmit} className="mt-3 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground-subtle">Select {title}</span>
              <Input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-8"
                placeholder={`Type to filter ${title.toLowerCase()}s…`}
                disabled={!Array.isArray(options) || options.length === 0 || submitting}
              />
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                className={cn(selectFieldClasses, 'h-8')}
                disabled={!Array.isArray(options) || options.length === 0 || submitting}
              >
                <option value="">Choose…</option>
                {filteredOptions.map((option) => (
                  <option key={option._id} value={option._id}>
                    {option.name}
                    {option.active === false ? ' (Inactive)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {selectedOption?.active === false && (
              <p className="rounded-lg border border-warning/30 bg-warning-soft px-2 py-1.5 text-xs text-warning">
                This {title.toLowerCase()} is marked inactive. You can still assign them, but verify this is intentional.
              </p>
            )}
            {type === 'agent' && (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-foreground-muted">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium text-foreground-muted">Need a recommendation?</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleSuggest}
                    loading={suggesting}
                  >
                    {suggesting ? 'Thinking…' : 'Suggest agent'}
                  </Button>
                </div>
                {suggestionReason && (
                  <p className="rounded-lg bg-surface-subtle p-2 text-xs text-foreground-muted">
                    <span className="font-semibold text-foreground-muted">Why:</span> {suggestionReason}
                  </p>
                )}
              </div>
            )}
            <Button type="submit" size="sm" className="w-full" disabled={!selected} loading={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
