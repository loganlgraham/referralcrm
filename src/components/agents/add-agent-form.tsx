'use client';

import {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

import { formatPhoneInput } from '@/utils/formatters';
import {
  AGENT_AHA_CLASSIFICATION_OPTIONS,
  AGENT_LANGUAGE_OPTIONS,
  AGENT_SPECIALTY_OPTIONS,
} from '@/constants/agent-options';

interface CoverageLocation {
  label: string;
  zipCodes: string[];
}

type AgentFormState = {
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  brokerage: string;
  officeAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  states: string;
  coverageDescription: string;
  coverageLocations: CoverageLocation[];
  specialties: string[];
  languages: string[];
  ahaDesignation: '' | 'AHA' | 'AHA_OOS' | 'AGIT';
  source: string;
};

type CreatedAgentSummary = {
  id: string;
  name: string;
  email: string;
};

const createEmptyForm = (): AgentFormState => ({
  name: '',
  email: '',
  phone: '',
  licenseNumber: '',
  brokerage: '',
  officeAddress: {
    street: '',
    city: '',
    state: '',
    zipCode: '',
  },
  states: '',
  coverageDescription: '',
  coverageLocations: [],
  specialties: [],
  languages: [],
  ahaDesignation: '',
  source: '',
});

interface AddAgentFormProps {
  onSuccess?: (agent: CreatedAgentSummary) => void;
  onClose?: () => void;
}

export function AddAgentForm({ onSuccess, onClose }: AddAgentFormProps) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AgentFormState>(() => createEmptyForm());
  const [isGeneratingCoverage, setIsGeneratingCoverage] = useState(false);
  const [coverageProgress, setCoverageProgress] = useState(0);
  const [lastCreatedAgent, setLastCreatedAgent] = useState<CreatedAgentSummary | null>(null);
  const [sendingWelcome, setSendingWelcome] = useState(false);
  const [sourceHistory, setSourceHistory] = useState<string[]>([]);

  const formDisabled = saving;

  type TextField = Exclude<keyof AgentFormState, 'coverageLocations' | 'specialties' | 'languages' | 'officeAddress'>;

  const handleChange = (field: TextField) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const value = field === 'phone' ? formatPhoneInput(event.target.value) : event.target.value;
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const handleOfficeAddressChange = (field: 'street' | 'city' | 'state' | 'zipCode') => (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    setForm((previous) => ({
      ...previous,
      officeAddress: {
        ...previous.officeAddress,
        [field]: event.target.value,
      },
    }));
  };

  const handleSelectChange = (field: 'specialties' | 'languages') => (
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    setForm((previous) => ({ ...previous, [field]: selected }));
  };

  const handleAhaChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setForm((previous) => ({ ...previous, ahaDesignation: event.target.value as AgentFormState['ahaDesignation'] }));
  };

  const normalizeZipCode = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 5) {
      return null;
    }
    return digits.slice(0, 5);
  };

  const deriveZipCodes = (locations: CoverageLocation[]): string[] =>
    Array.from(
      new Set(
        locations.flatMap((location) =>
          (Array.isArray(location.zipCodes) ? location.zipCodes : [])
            .map((zip) => normalizeZipCode(zip))
            .filter((zip: string | null): zip is string => Boolean(zip))
        )
      )
    );

  const mergeCoverageLocations = (
    existing: CoverageLocation[],
    incoming: CoverageLocation[]
  ): CoverageLocation[] => {
    const merged = new Map<string, CoverageLocation>();

    existing.forEach((location) => {
      merged.set(location.label.toLowerCase(), {
        label: location.label,
        zipCodes: Array.from(new Set(location.zipCodes)),
      });
    });

    incoming.forEach((location) => {
      const label = location.label?.trim();
      if (!label) {
        return;
      }

      const normalizedZipCodes = Array.from(
        new Set(
          (Array.isArray(location.zipCodes) ? location.zipCodes : [])
            .map((zip) => normalizeZipCode(zip))
            .filter((zip: string | null): zip is string => Boolean(zip))
        )
      );

      if (normalizedZipCodes.length === 0) {
        return;
      }

      const key = label.toLowerCase();
      const existingLocation = merged.get(key);
      if (existingLocation) {
        merged.set(key, {
          label: existingLocation.label,
          zipCodes: Array.from(new Set([...existingLocation.zipCodes, ...normalizedZipCodes])),
        });
      } else {
        merged.set(key, { label, zipCodes: normalizedZipCodes });
      }
    });

    return Array.from(merged.values());
  };

  const updateCoverageLocations = (updater: (current: CoverageLocation[]) => CoverageLocation[]) => {
    setForm((previous) => ({
      ...previous,
      coverageLocations: updater(previous.coverageLocations),
    }));
  };

  const removeCoverageLocation = (label: string) => {
    const normalized = label.toLowerCase();
    updateCoverageLocations((current) =>
      current.filter((location) => location.label.toLowerCase() !== normalized)
    );
  };

  const addCoverageLocations = (locations: CoverageLocation[]) => {
    updateCoverageLocations((current) => mergeCoverageLocations(current, locations));
  };

  const generateCoverageLocations = async () => {
    const description = form.coverageDescription.trim();
    if (!description) {
      toast.error("Describe the agent's coverage areas first.");
      return;
    }

    setIsGeneratingCoverage(true);
    setCoverageProgress(12);
    try {
      const response = await fetch('/api/coverage/zip-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Unable to generate ZIP codes');
      }

      const payload = await response.json();
      const receivedLocations = Array.isArray(payload?.locations) ? payload.locations : [];
      const normalizedLocations = receivedLocations
        .map((location: CoverageLocation | null | undefined) => {
          const label = location?.label?.trim() ?? '';
          const zipCodes = Array.from(
            new Set(
              (Array.isArray(location?.zipCodes) ? location.zipCodes : [])
                .map((zip) => normalizeZipCode(zip))
                .filter((zip: string | null): zip is string => Boolean(zip))
            )
          );

          return { label, zipCodes };
        })
        .filter(
          (location: { label: string; zipCodes: string[] }): location is CoverageLocation =>
            Boolean(location.label) && location.zipCodes.length > 0
        );

      if (normalizedLocations.length === 0) {
        const fallbackZipCodes = Array.isArray(payload?.zipCodes) ? payload.zipCodes : [];
        const fallbackLocations = fallbackZipCodes
          .map((zip: string) => normalizeZipCode(zip))
          .filter((zip: string | null): zip is string => Boolean(zip))
          .map((zip: string) => ({ label: zip, zipCodes: [zip] }));

        if (fallbackLocations.length === 0) {
          toast.info('No coverage locations were identified. Try adding more detail.');
          return;
        }

        addCoverageLocations(fallbackLocations);
        toast.success('ZIP codes added as coverage placeholders.');
        return;
      }

      addCoverageLocations(normalizedLocations);

      toast.success('Coverage locations added to the agent.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to generate coverage locations');
    } finally {
      setCoverageProgress(100);
      setIsGeneratingCoverage(false);
    }
  };

  const coverageButtonStyles = useMemo<CSSProperties | undefined>(() => {
    if (!isGeneratingCoverage && coverageProgress === 0) {
      return undefined;
    }

    const progress = Math.min(Math.max(coverageProgress, 0), 100);

    return {
      backgroundImage: `linear-gradient(90deg, #0b365d 0%, #0b365d ${progress}%, #0f4c81 ${progress}%, #2f6aa3 100%)`,
      transition: 'background-image 250ms linear',
    };
  }, [coverageProgress, isGeneratingCoverage]);

  useEffect(() => {
    if (!isGeneratingCoverage) {
      return;
    }

    setCoverageProgress((value) => (value < 12 ? 12 : value));
    const interval = window.setInterval(() => {
      setCoverageProgress((value) => {
        if (value >= 88) {
          return 88;
        }
        return value + 4;
      });
    }, 400);

    return () => {
      window.clearInterval(interval);
    };
  }, [isGeneratingCoverage]);

  useEffect(() => {
    if (isGeneratingCoverage || coverageProgress === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCoverageProgress(0);
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isGeneratingCoverage, coverageProgress]);

  useEffect(() => {
    if (!isAdmin) return;

    const fetchMetadata = async () => {
      try {
        const response = await fetch('/api/referrals/metadata');
        if (response.ok) {
          const data = (await response.json()) as { agentSources?: string[] };
          setSourceHistory(data.agentSources ?? []);
        }
      } catch (error) {
        console.error('Failed to fetch agent source metadata', error);
      }
    };

    fetchMetadata();
  }, [isAdmin]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    // Validate AHA designation (HTML5 required should prevent this, but add runtime check for type safety)
    if (form.ahaDesignation !== 'AHA' && form.ahaDesignation !== 'AHA_OOS' && form.ahaDesignation !== 'AGIT') {
      toast.error('AHA classification is required');
      return;
    }

    const trimmedSource = form.source.trim();
    if (isAdmin && !trimmedSource) {
      toast.error('Source is required');
      return;
    }
    
    setSaving(true);

    try {
      const statesLicensed = form.states
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const normalizedCoverageLocations = mergeCoverageLocations([], form.coverageLocations);
      const coverageZipCodes = deriveZipCodes(normalizedCoverageLocations);
      const officeAddress = {
        street: form.officeAddress.street.trim() || undefined,
        city: form.officeAddress.city.trim() || undefined,
        state: form.officeAddress.state.trim() || undefined,
        zipCode: form.officeAddress.zipCode.trim() || undefined,
      };
      const hasOfficeAddress = Object.values(officeAddress).some((value) => value !== undefined);

      const body: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        licenseNumber: form.licenseNumber,
        brokerage: form.brokerage,
        officeAddress: hasOfficeAddress ? officeAddress : undefined,
        statesLicensed,
        coverageAreas: coverageZipCodes,
        coverageLocations: normalizedCoverageLocations,
        specialties: form.specialties,
        languages: form.languages,
        ahaDesignation: form.ahaDesignation as 'AHA' | 'AHA_OOS' | 'AGIT',
      };

      if (isAdmin) {
        body.source = trimmedSource;
      }

      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && payload?.existingAgentName) {
          throw new Error(
            `${payload.message} Existing agent: ${payload.existingAgentName}`
          );
        }
        throw new Error(payload?.message ?? 'Unable to create agent');
      }

      const createdId = typeof payload?.id === 'string' ? payload.id : null;

      toast.success('Agent added');
      const createdAgent = createdId
        ? {
            id: createdId,
            name: form.name,
            email: form.email,
          }
        : null;

      if (createdAgent) {
        setLastCreatedAgent(createdAgent);
        onSuccess?.(createdAgent);
      }

      setForm(createEmptyForm());
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save agent');
    } finally {
      setSaving(false);
    }
  };

  const handleSendWelcomeEmail = async () => {
    if (!lastCreatedAgent) {
      return;
    }

    setSendingWelcome(true);

    try {
      const response = await fetch(`/api/agents/${lastCreatedAgent.id}/welcome-email`, {
        method: 'POST',
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? payload?.message ?? 'Unable to send welcome email');
      }

      toast.success(`Welcome email sent to ${lastCreatedAgent.name}`);
      setLastCreatedAgent(null);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to send welcome email');
    } finally {
      setSendingWelcome(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      {lastCreatedAgent && (
        <div className="rounded-card border border-border bg-surface-raised p-4 shadow-card">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Send welcome email to {lastCreatedAgent.name}
              </p>
              <p className="text-xs text-foreground-muted">{lastCreatedAgent.email}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSendWelcomeEmail}
                disabled={sendingWelcome}
                className="rounded bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {sendingWelcome ? 'Sending…' : 'Send welcome email'}
              </button>
              <button
                type="button"
                onClick={() => setLastCreatedAgent(null)}
                className="rounded border border-border px-4 py-2 text-sm font-semibold text-foreground-muted hover:bg-surface-muted"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold text-foreground-muted">
            Name
            <input
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              required
              disabled={formDisabled}
            />
          </label>
          <label className="text-xs font-semibold text-foreground-muted">
            Email
            <input
              type="email"
              value={form.email}
              onChange={handleChange('email')}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              required
              disabled={formDisabled}
            />
          </label>
          <label className="text-xs font-semibold text-foreground-muted">
            Phone
            <input
              type="tel"
              value={form.phone}
              onChange={handleChange('phone')}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              disabled={formDisabled}
              onBlur={(event) =>
                setForm((previous) => ({
                  ...previous,
                  phone: formatPhoneInput(event.target.value),
                }))
              }
            />
          </label>
          <label className="text-xs font-semibold text-foreground-muted">
            License number
            <input
              type="text"
              value={form.licenseNumber}
              onChange={handleChange('licenseNumber')}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              disabled={formDisabled}
            />
          </label>
          <label className="text-xs font-semibold text-foreground-muted">
            Brokerage
            <input
              type="text"
              value={form.brokerage}
              onChange={handleChange('brokerage')}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              disabled={formDisabled}
            />
          </label>
          {isAdmin && (
            <label className="text-xs font-semibold text-foreground-muted">
              Source
              <input
                type="text"
                value={form.source}
                onChange={handleChange('source')}
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                placeholder="Where did we recruit this agent from?"
                disabled={formDisabled}
                list={sourceHistory.length > 0 ? 'agent-source-history' : undefined}
                required
              />
              {sourceHistory.length > 0 && (
                <datalist id="agent-source-history">
                  {sourceHistory.map((entry) => (
                    <option key={entry} value={entry} />
                  ))}
                </datalist>
              )}
            </label>
          )}
          <div className="md:col-span-2 space-y-2">
            <p className="text-xs font-semibold text-foreground-muted">Office Address</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-foreground-muted md:col-span-2">
                Street
                <input
                  type="text"
                  value={form.officeAddress.street}
                  onChange={handleOfficeAddressChange('street')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                  placeholder="123 Main St"
                  disabled={formDisabled}
                />
              </label>
              <label className="text-xs font-semibold text-foreground-muted">
                City
                <input
                  type="text"
                  value={form.officeAddress.city}
                  onChange={handleOfficeAddressChange('city')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                  placeholder="Denver"
                  disabled={formDisabled}
                />
              </label>
              <label className="text-xs font-semibold text-foreground-muted">
                State
                <input
                  type="text"
                  value={form.officeAddress.state}
                  onChange={handleOfficeAddressChange('state')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm uppercase"
                  placeholder="CO"
                  maxLength={2}
                  disabled={formDisabled}
                />
              </label>
              <label className="text-xs font-semibold text-foreground-muted">
                ZIP Code
                <input
                  type="text"
                  value={form.officeAddress.zipCode}
                  onChange={handleOfficeAddressChange('zipCode')}
                  className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                  placeholder="80202"
                  maxLength={5}
                  disabled={formDisabled}
                />
              </label>
            </div>
          </div>
          <label className="text-xs font-semibold text-foreground-muted">
            AHA classification
            <select
              value={form.ahaDesignation}
              onChange={handleAhaChange}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              required
              disabled={formDisabled}
            >
              {AGENT_AHA_CLASSIFICATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'AHA_OOS' ? 'AHA OOS' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-foreground-muted">
            States (comma separated)
            <input
              type="text"
              value={form.states}
              onChange={handleChange('states')}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              placeholder="CO, UT"
              disabled={formDisabled}
            />
          </label>
          <div className="md:col-span-2 space-y-2">
            <label
              htmlFor="new-agent-coverage-description"
              className="text-xs font-semibold text-foreground-muted"
            >
              Areas covered
            </label>
            <div className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-3">
              <textarea
                id="new-agent-coverage-description"
                value={form.coverageDescription}
                onChange={handleChange('coverageDescription')}
                className="w-full flex-1 rounded border border-border px-3 py-2 text-sm md:min-h-[5.5rem]"
                placeholder="Describe the neighborhoods, cities, and counties this agent serves"
                rows={3}
                disabled={formDisabled || isGeneratingCoverage}
              />
              <button
                type="button"
                onClick={generateCoverageLocations}
                className="flex shrink-0 items-center justify-center rounded bg-primary-600 px-4 text-sm font-semibold text-white transition hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-70 md:h-full md:min-h-[5.5rem] md:self-stretch"
                style={coverageButtonStyles}
                disabled={formDisabled || isGeneratingCoverage}
              >
                {isGeneratingCoverage ? 'Generating…' : 'Save Service Areas'}
              </button>
            </div>
          </div>
          <div className="md:col-span-2 space-y-2">
            <p className="text-xs font-semibold text-foreground-muted">Cities, towns & counties</p>
            <div className="flex flex-wrap gap-2">
              {form.coverageLocations.length === 0 ? (
                <p className="text-xs text-foreground-subtle">No coverage locations added yet.</p>
              ) : (
                form.coverageLocations.map((location) => (
                  <span
                    key={location.label}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-3 py-1 text-[11px] font-semibold text-foreground-muted"
                  >
                    {location.label}
                    <button
                      type="button"
                      onClick={() => removeCoverageLocation(location.label)}
                      className="text-foreground-subtle transition hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60"
                      aria-label={`Remove ${location.label}`}
                      disabled={formDisabled}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="md:col-span-2 grid gap-3">
            <label className="text-xs font-semibold text-foreground-muted">
              Specialties
              <select
                multiple
                value={form.specialties}
                onChange={handleSelectChange('specialties')}
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                size={6}
                disabled={formDisabled}
              >
                {AGENT_SPECIALTY_OPTIONS.map((specialty) => (
                  <option key={specialty} value={specialty}>
                    {specialty}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] font-normal text-foreground-subtle">
                Hold Ctrl (Windows) or Command (Mac) to select multiple specialties.
              </span>
            </label>
            <label className="text-xs font-semibold text-foreground-muted">
              Languages spoken
              <select
                multiple
                value={form.languages}
                onChange={handleSelectChange('languages')}
                className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
                size={5}
                disabled={formDisabled}
              >
                {AGENT_LANGUAGE_OPTIONS.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] font-normal text-foreground-subtle">
                Hold Ctrl (Windows) or Command (Mac) to select multiple languages.
              </span>
            </label>
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={formDisabled}
              className="rounded bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? 'Saving…' : 'Save agent'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
