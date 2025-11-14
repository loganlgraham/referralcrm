'use client';

import { ChangeEvent, CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  AGENT_AHA_CLASSIFICATION_OPTIONS,
  AGENT_LANGUAGE_OPTIONS,
  AGENT_SPECIALTY_OPTIONS,
} from '@/constants/agent-options';

interface CoverageLocation {
  label: string;
  zipCodes: string[];
}

interface AgentAdminEditorProps {
  agent: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
    licenseNumber?: string;
    brokerage?: string;
    statesLicensed?: string[];
    coverageLocations?: CoverageLocation[];
    coverageAreas?: string[];
    specialties?: string[];
    languages?: string[];
    ahaDesignation?: 'AHA' | 'AHA_OOS' | null;
  };
}

interface PatchResponse {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  licenseNumber?: string;
  brokerage?: string;
  statesLicensed: string[];
  coverageAreas: string[];
  coverageLocations: CoverageLocation[];
  specialties: string[];
  languages: string[];
  ahaDesignation: 'AHA' | 'AHA_OOS' | null;
}

type FormState = {
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  brokerage: string;
  states: string;
  coverageDescription: string;
  coverageLocations: CoverageLocation[];
  specialties: string[];
  languages: string[];
  ahaDesignation: '' | 'AHA' | 'AHA_OOS';
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
    states: Array.isArray(agent.statesLicensed) ? agent.statesLicensed.join(', ') : '',
    coverageDescription: '',
    coverageLocations,
    specialties: Array.isArray(agent.specialties) ? agent.specialties : [],
    languages: Array.isArray(agent.languages) ? agent.languages : [],
    ahaDesignation: agent.ahaDesignation ?? '',
  };
};

export function AgentAdminEditor({ agent }: AgentAdminEditorProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => buildInitialFormState(agent));
  const [saving, setSaving] = useState(false);
  const [isGeneratingCoverage, setIsGeneratingCoverage] = useState(false);
  const [coverageProgress, setCoverageProgress] = useState(0);

  useEffect(() => {
    setForm(buildInitialFormState(agent));
  }, [agent]);

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
      backgroundImage: `linear-gradient(90deg, #0b365d 0%, #0b365d ${progress}%, #0f4c81 ${progress}%, #2f6aa3 100%)`,
      transition: 'background-image 250ms linear',
    };
  }, [coverageProgress, isGeneratingCoverage]);

  const formDisabled = saving;

  type TextField = Exclude<keyof FormState, 'coverageLocations' | 'specialties' | 'languages' | 'coverageDescription' | 'ahaDesignation'>;

  const handleChange = (field: TextField) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
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

      const response = await fetch(`/api/agents/${agent._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          licenseNumber: form.licenseNumber,
          brokerage: form.brokerage,
          statesLicensed,
          coverageAreas: coverageZipCodes,
          coverageLocations: normalizedCoverageLocations,
          specialties: form.specialties,
          languages: form.languages,
          ahaDesignation: form.ahaDesignation || null,
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
        states: payload.statesLicensed.join(', '),
        coverageDescription: '',
        coverageLocations: mergeCoverageLocations([], payload.coverageLocations),
        specialties: payload.specialties,
        languages: payload.languages,
        ahaDesignation: payload.ahaDesignation ?? '',
      });

      toast.success('Agent details updated');
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update agent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Edit agent details</h2>
      <p className="mt-1 text-sm text-slate-500">Update contact info, coverage, specialties, and AHA designation.</p>
      <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">
          Name
          <input
            type="text"
            value={form.name}
            onChange={handleChange('name')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
            required
            disabled={formDisabled}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Email
          <input
            type="email"
            value={form.email}
            onChange={handleChange('email')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
            required
            disabled={formDisabled}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Phone
          <input
            type="tel"
            value={form.phone}
            onChange={handleChange('phone')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
            disabled={formDisabled}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          License number
          <input
            type="text"
            value={form.licenseNumber}
            onChange={handleChange('licenseNumber')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
            disabled={formDisabled}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Brokerage
          <input
            type="text"
            value={form.brokerage}
            onChange={handleChange('brokerage')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
            disabled={formDisabled}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          AHA classification
          <select
            value={form.ahaDesignation}
            onChange={handleAhaChange}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
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
        <label className="text-xs font-semibold text-slate-600">
          States (comma separated)
          <input
            type="text"
            value={form.states}
            onChange={handleChange('states')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
            placeholder="CO, UT"
            disabled={formDisabled}
          />
        </label>
        <div className="md:col-span-2 space-y-2">
          <label htmlFor="edit-agent-coverage-description" className="text-xs font-semibold text-slate-600">
            Areas covered
          </label>
          <div className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-3">
            <textarea
              id="edit-agent-coverage-description"
              value={form.coverageDescription}
              onChange={handleCoverageDescriptionChange}
              className="w-full flex-1 rounded border border-slate-200 px-3 py-2 text-sm md:min-h-[5.5rem]"
              placeholder="Describe the neighborhoods, cities, and counties this agent serves"
              rows={3}
              disabled={formDisabled || isGeneratingCoverage}
            />
            <button
              type="button"
              onClick={generateCoverageLocations}
              className="flex shrink-0 items-center justify-center rounded bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-70 md:h-full md:min-h-[5.5rem] md:self-stretch"
              style={coverageButtonStyles}
              disabled={formDisabled || isGeneratingCoverage}
            >
              {isGeneratingCoverage ? 'Generating…' : 'Save Service Areas'}
            </button>
          </div>
        </div>
        <div className="md:col-span-2 space-y-2">
          <p className="text-xs font-semibold text-slate-600">Cities, towns & counties</p>
          <div className="flex flex-wrap gap-2">
            {form.coverageLocations.length === 0 ? (
              <p className="text-xs text-slate-500">No coverage locations added yet.</p>
            ) : (
              form.coverageLocations.map((location) => (
                <span
                  key={location.label}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700"
                >
                  {location.label}
                  <button
                    type="button"
                    onClick={() => removeCoverageLocation(location.label)}
                    className="text-slate-400 transition hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
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
          <label className="text-xs font-semibold text-slate-600">
            Specialties
            <select
              multiple
              value={form.specialties}
              onChange={handleSelectChange('specialties')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
              size={6}
              disabled={formDisabled}
            >
              {AGENT_SPECIALTY_OPTIONS.map((specialty) => (
                <option key={specialty} value={specialty}>
                  {specialty}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] font-normal text-slate-500">
              Hold Ctrl (Windows) or Command (Mac) to select multiple specialties.
            </span>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Languages spoken
            <select
              multiple
              value={form.languages}
              onChange={handleSelectChange('languages')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
              size={5}
              disabled={formDisabled}
            >
              {AGENT_LANGUAGE_OPTIONS.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] font-normal text-slate-500">
              Hold Ctrl (Windows) or Command (Mac) to select multiple languages.
            </span>
          </label>
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={formDisabled}
            className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
