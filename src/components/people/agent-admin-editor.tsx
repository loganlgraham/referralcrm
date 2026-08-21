'use client';

import { ChangeEvent, CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

import {
  AGENT_AHA_CLASSIFICATION_OPTIONS,
  AGENT_LANGUAGE_OPTIONS,
  AGENT_SPECIALTY_OPTIONS,
} from '@/constants/agent-options';
import { Button } from '@/components/ui/button';
import { FieldLabel, selectFieldClasses } from '@/components/ui/field-group';
import { Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';

interface CoverageLocation {
  label: string;
  zipCodes: string[];
}

export interface AgentAdminEditorProps {
  agent: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
    licenseNumber?: string;
    brokerage?: string;
    officeAddress?: {
      street?: string;
      city?: string;
      state?: string;
      zipCode?: string;
    };
    statesLicensed?: string[];
    coverageLocations?: CoverageLocation[];
    coverageAreas?: string[];
    specialties?: string[];
    languages?: string[];
    ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
    npsScore?: number | null;
    source?: string;
    active?: boolean;
  };
  variant?: 'standalone' | 'embedded';
  className?: string;
  onSaved?: () => void;
}

interface PatchResponse {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  licenseNumber?: string;
  brokerage?: string;
  officeAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  statesLicensed: string[];
  coverageAreas: string[];
  coverageLocations: CoverageLocation[];
  specialties: string[];
  languages: string[];
  ahaDesignation: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
  source?: string;
  active: boolean;
}

type FormState = {
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
  active: boolean;
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

const buildInitialFormState = (agent: AgentAdminEditorProps['agent']): FormState => {
  const coverageLocations = Array.isArray(agent.coverageLocations)
    ? mergeCoverageLocations([], agent.coverageLocations)
    : [];
  const fallbackZipCodes = Array.isArray(agent.coverageAreas) ? agent.coverageAreas : [];

  if (coverageLocations.length === 0 && fallbackZipCodes.length > 0) {
    const fallbackLocations = fallbackZipCodes
      .map((zip) => normalizeZipCode(zip))
      .filter((zip: string | null): zip is string => Boolean(zip))
      .map((zip) => ({ label: zip, zipCodes: [zip] }));

    coverageLocations.push(...fallbackLocations);
  }

  return {
    name: agent.name,
    email: agent.email,
    phone: agent.phone ?? '',
    licenseNumber: agent.licenseNumber ?? '',
    brokerage: agent.brokerage ?? '',
    officeAddress: {
      street: agent.officeAddress?.street ?? '',
      city: agent.officeAddress?.city ?? '',
      state: agent.officeAddress?.state ?? '',
      zipCode: agent.officeAddress?.zipCode ?? '',
    },
    states: Array.isArray(agent.statesLicensed) ? agent.statesLicensed.join(', ') : '',
    coverageDescription: '',
    coverageLocations,
    specialties: Array.isArray(agent.specialties) ? agent.specialties : [],
    languages: Array.isArray(agent.languages) ? agent.languages : [],
    ahaDesignation: agent.ahaDesignation ?? '',
    source: agent.source ?? '',
    active: agent.active ?? true,
  };
};

export function AgentAdminEditor({ agent, variant = 'standalone', className, onSaved }: AgentAdminEditorProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [form, setForm] = useState<FormState>(() => buildInitialFormState(agent));
  const [saving, setSaving] = useState(false);
  const [isGeneratingCoverage, setIsGeneratingCoverage] = useState(false);
  const [coverageProgress, setCoverageProgress] = useState(0);
  const [sourceHistory, setSourceHistory] = useState<string[]>([]);

  useEffect(() => {
    setForm(buildInitialFormState(agent));
  }, [agent]);

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
  }, [coverageProgress, isGeneratingCoverage]);

  const coverageButtonStyles = useMemo<CSSProperties | undefined>(() => {
    if (!isGeneratingCoverage && coverageProgress === 0) {
      return undefined;
    }

    const progress = Math.min(Math.max(coverageProgress, 0), 100);

    return {
      backgroundImage: `linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary)) %, hsl(var(--primary-hover)) %, hsl(var(--border-strong)) 100%)`,
      transition: 'background-image 250ms linear',
    };
  }, [coverageProgress, isGeneratingCoverage]);

  const formDisabled = saving;

  type TextField = Exclude<keyof FormState, 'coverageLocations' | 'specialties' | 'languages' | 'coverageDescription' | 'ahaDesignation' | 'officeAddress'>;

  const handleChange = (field: TextField) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
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

  const handleCoverageDescriptionChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setForm((previous) => ({ ...previous, coverageDescription: event.target.value }));
  };

  const handleSelectChange = (field: 'specialties' | 'languages') => (
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    setForm((previous) => ({ ...previous, [field]: selected }));
  };

  const handleAhaChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setForm((previous) => ({ ...previous, ahaDesignation: event.target.value as FormState['ahaDesignation'] }));
  };

  const handleActiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, active: event.target.checked }));
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
      toast.error('Describe the agent’s coverage areas first.');
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

      const response = await fetch(`/api/agents/${agent._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
          ahaDesignation: form.ahaDesignation || null,
          source: isAdmin && form.source.trim() ? form.source.trim() : undefined,
          active: isAdmin ? form.active : undefined,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? 'Unable to update agent');
      }

      const payload: PatchResponse = await response.json();
      setForm({
        name: payload.name,
        email: payload.email,
        phone: payload.phone ?? '',
        licenseNumber: payload.licenseNumber ?? '',
        brokerage: payload.brokerage ?? '',
        officeAddress: {
          street: payload.officeAddress?.street ?? '',
          city: payload.officeAddress?.city ?? '',
          state: payload.officeAddress?.state ?? '',
          zipCode: payload.officeAddress?.zipCode ?? '',
        },
        states: payload.statesLicensed.join(', '),
        coverageDescription: '',
        coverageLocations: mergeCoverageLocations([], payload.coverageLocations),
        specialties: payload.specialties,
        languages: payload.languages,
        ahaDesignation: payload.ahaDesignation ?? '',
        source: payload.source ?? '',
        active: payload.active,
      });

      toast.success('Agent details updated');
      onSaved?.();
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update agent');
    } finally {
      setSaving(false);
    }
  };

  const wrapperClassName =
    variant === 'standalone'
      ? 'rounded-card border border-border bg-surface-raised p-6 shadow-card'
      : className || 'space-y-4';

  return (
    <div className={wrapperClassName}>
      <h2 className="text-eyebrow text-foreground-subtle">Edit agent details</h2>
      <p className="mt-1.5 text-xs text-foreground-muted">Update contact info, coverage, specialties, AHA designation, and active status.</p>
      <form onSubmit={handleSubmit} className="mt-4 grid gap-x-4 gap-y-3 md:grid-cols-2">
        <label className="block space-y-1.5">
          <FieldLabel label="Name" />
          <Input type="text" value={form.name} onChange={handleChange('name')} required disabled={formDisabled} />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel label="Email" />
          <Input type="email" value={form.email} onChange={handleChange('email')} required disabled={formDisabled} />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel label="Phone" />
          <Input
            type="tel"
            value={form.phone}
            onChange={handleChange('phone')}
            disabled={formDisabled}
            className="text-numeric"
          />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel label="License number" />
          <Input
            type="text"
            value={form.licenseNumber}
            onChange={handleChange('licenseNumber')}
            disabled={formDisabled}
            className="text-numeric"
          />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel label="Brokerage" />
          <Input type="text" value={form.brokerage} onChange={handleChange('brokerage')} disabled={formDisabled} />
        </label>
        {isAdmin && (
          <label className="block space-y-1.5">
            <FieldLabel label="Source" />
            <Input
              type="text"
              value={form.source}
              onChange={handleChange('source')}
              placeholder="Where did we recruit this agent from?"
              disabled={formDisabled}
              list={sourceHistory.length > 0 ? 'agent-source-history' : undefined}
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
        <div className="space-y-2 md:col-span-2">
          <p className="text-eyebrow text-foreground-subtle">Office address</p>
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
            <label className="block space-y-1.5 md:col-span-2">
              <FieldLabel label="Street" />
              <Input
                type="text"
                value={form.officeAddress.street}
                onChange={handleOfficeAddressChange('street')}
                placeholder="123 Main St"
                disabled={formDisabled}
              />
            </label>
            <label className="block space-y-1.5">
              <FieldLabel label="City" />
              <Input
                type="text"
                value={form.officeAddress.city}
                onChange={handleOfficeAddressChange('city')}
                placeholder="Denver"
                disabled={formDisabled}
              />
            </label>
            <label className="block space-y-1.5">
              <FieldLabel label="State" />
              <Input
                type="text"
                value={form.officeAddress.state}
                onChange={handleOfficeAddressChange('state')}
                className="uppercase"
                placeholder="CO"
                maxLength={2}
                disabled={formDisabled}
              />
            </label>
            <label className="block space-y-1.5">
              <FieldLabel label="ZIP code" />
              <Input
                type="text"
                value={form.officeAddress.zipCode}
                onChange={handleOfficeAddressChange('zipCode')}
                className="text-numeric"
                placeholder="80202"
                maxLength={5}
                disabled={formDisabled}
              />
            </label>
          </div>
        </div>
        <label className="block space-y-1.5">
          <FieldLabel label="AHA classification" />
          <select
            value={form.ahaDesignation}
            onChange={handleAhaChange}
            className={selectFieldClasses}
            disabled={formDisabled}
          >
            <option value="">Not set</option>
            {AGENT_AHA_CLASSIFICATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 'AHA_OOS' ? 'AHA OOS' : option}
              </option>
            ))}
          </select>
        </label>
        {isAdmin && (
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={form.active}
              onChange={handleActiveChange}
              className="h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
              disabled={formDisabled}
            />
            Agent is active
          </label>
        )}
        <label className="block space-y-1.5">
          <FieldLabel label="States" hint="comma separated" />
          <Input
            type="text"
            value={form.states}
            onChange={handleChange('states')}
            placeholder="CO, UT"
            disabled={formDisabled}
          />
        </label>
        <div className="space-y-1.5 md:col-span-2">
          <label htmlFor="edit-agent-coverage-description">
            <FieldLabel label="Areas covered" />
          </label>
          <div className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-3">
            <Textarea
              id="edit-agent-coverage-description"
              value={form.coverageDescription}
              onChange={handleCoverageDescriptionChange}
              className="flex-1 md:min-h-[5.5rem]"
              placeholder="Describe the neighborhoods, cities, and counties this agent serves"
              rows={3}
              disabled={formDisabled || isGeneratingCoverage}
            />
            <Button
              className="shrink-0 md:h-full md:min-h-[5.5rem] md:self-stretch"
              onClick={generateCoverageLocations}
              style={coverageButtonStyles}
              loading={isGeneratingCoverage}
              disabled={formDisabled || isGeneratingCoverage}
            >
              {isGeneratingCoverage ? 'Generating…' : 'Save service areas'}
            </Button>
          </div>
        </div>
        <div className="space-y-2 md:col-span-2">
          <p className="text-eyebrow text-foreground-subtle">Cities, towns &amp; counties</p>
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
                    className="text-foreground-subtle transition hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
        <div className="grid gap-3 md:col-span-2">
          <label className="block space-y-1.5">
            <FieldLabel label="Specialties" hint="hold Ctrl or Command to pick several" />
            <select
              multiple
              value={form.specialties}
              onChange={handleSelectChange('specialties')}
              className={cn(selectFieldClasses, 'h-auto py-2')}
              size={6}
              disabled={formDisabled}
            >
              {AGENT_SPECIALTY_OPTIONS.map((specialty) => (
                <option key={specialty} value={specialty}>
                  {specialty}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <FieldLabel label="Languages spoken" hint="hold Ctrl or Command to pick several" />
            <select
              multiple
              value={form.languages}
              onChange={handleSelectChange('languages')}
              className={cn(selectFieldClasses, 'h-auto py-2')}
              size={5}
              disabled={formDisabled}
            >
              {AGENT_LANGUAGE_OPTIONS.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="md:col-span-2">
          <Button type="submit" loading={saving} disabled={formDisabled}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
