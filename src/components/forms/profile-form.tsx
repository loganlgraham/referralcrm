'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { differenceInYears, parseISO } from 'date-fns';

import { fetcher } from '@/utils/fetcher';
import { AGENT_LANGUAGE_OPTIONS, AGENT_SPECIALTY_OPTIONS } from '@/constants/agent-options';

interface CoverageLocation {
  label: string;
  zipCodes: string[];
}

interface AgentProfileResponse {
  role: 'agent';
  _id: string;
  name: string;
  email: string;
  phone: string;
  statesLicensed: string[];
  coverageAreas: string[];
  coverageLocations?: CoverageLocation[];
  licenseNumber?: string;
  brokerage?: string;
  markets?: string[];
  experienceSince?: string | null;
  specialties?: string[];
  languages?: string[];
}

interface McProfileResponse {
  role: 'mc';
  _id: string;
  name: string;
  email: string;
  phone: string;
  licensedStates: string[];
}

interface AdminProfileResponse {
  role: 'admin';
  name: string | null;
  email: string | null;
}

type ProfileResponse = AgentProfileResponse | McProfileResponse | AdminProfileResponse;

type FormState = {
  name: string;
  email: string;
  phone: string;
  states: string;
  coverageDescription: string;
  coverageLocations: CoverageLocation[];
  licenseNumber: string;
  brokerage: string;
  markets: string;
  experienceSince: string;
  specialties: string[];
  languages: string[];
};

const formatPhoneInput = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export function ProfileForm() {
  const { data, mutate } = useSWR<ProfileResponse>('/api/me/profile', fetcher);
  const [saving, setSaving] = useState(false);

  const normalizeZipCode = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 5) {
      return null;
    }
    return digits.slice(0, 5);
  };

  const sanitizeCoverageLocations = (
    locations: CoverageLocation[] | undefined,
    fallbackZipCodes: string[] = []
  ): CoverageLocation[] => {
    const uniqueByLabel = new Map<string, CoverageLocation>();

    if (Array.isArray(locations)) {
      locations.forEach((location) => {
        const label = location?.label?.trim();
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
        const existing = uniqueByLabel.get(key);
        if (existing) {
          const merged = Array.from(new Set([...existing.zipCodes, ...normalizedZipCodes]));
          uniqueByLabel.set(key, { label: existing.label, zipCodes: merged });
        } else {
          uniqueByLabel.set(key, { label, zipCodes: normalizedZipCodes });
        }
      });
    }

    if (uniqueByLabel.size > 0) {
      return Array.from(uniqueByLabel.values());
    }

    const normalizedFallback = Array.from(
      new Set(
        fallbackZipCodes
          .map((zip: string) => normalizeZipCode(zip))
          .filter((zip: string | null): zip is string => Boolean(zip))
      )
    );

    if (normalizedFallback.length === 0) {
      return [];
    }

    return normalizedFallback.map((zip: string) => ({ label: zip, zipCodes: [zip] }));
  };

  const initialState = useMemo<FormState>(() => {
    if (!data) {
      return {
        name: '',
        email: '',
        phone: '',
        states: '',
        coverageDescription: '',
        coverageLocations: [],
        licenseNumber: '',
        brokerage: '',
        markets: '',
        experienceSince: '',
        specialties: [],
        languages: [],
      };
    }

    if (data.role === 'agent') {
      const coverageLocations = sanitizeCoverageLocations(
        data.coverageLocations,
        data.coverageAreas ?? []
      );
      return {
        name: data.name,
        email: data.email,
        phone: data.phone ?? '',
        states: (data.statesLicensed ?? []).join(', '),
        coverageDescription: '',
        coverageLocations,
        licenseNumber: data.licenseNumber ?? '',
        brokerage: data.brokerage ?? '',
        markets: (data.markets ?? []).join(', '),
        experienceSince: data.experienceSince ? data.experienceSince.slice(0, 10) : '',
        specialties: Array.isArray(data.specialties) ? data.specialties : [],
        languages: Array.isArray(data.languages) ? data.languages : [],
      };
    }

    if (data.role === 'mc') {
      return {
        name: data.name,
        email: data.email,
        phone: data.phone ?? '',
        states: (data.licensedStates ?? []).join(', '),
        coverageDescription: '',
        coverageLocations: [],
        licenseNumber: '',
        brokerage: '',
        markets: '',
        experienceSince: '',
        specialties: [],
        languages: [],
      };
    }

    return {
      name: data.name ?? '',
      email: data.email ?? '',
      phone: '',
      states: '',
      coverageDescription: '',
      coverageLocations: [],
      licenseNumber: '',
      brokerage: '',
      markets: '',
      experienceSince: '',
      specialties: [],
      languages: [],
    };
  }, [data]);

  const [form, setForm] = useState<FormState>(initialState);
  const [isEditing, setIsEditing] = useState(true);
  const [isGeneratingCoverage, setIsGeneratingCoverage] = useState(false);
  const [manualLocationLabel, setManualLocationLabel] = useState('');
  const [manualLocationZipInput, setManualLocationZipInput] = useState('');

  useEffect(() => {
    setForm(initialState);
    setManualLocationLabel('');
    setManualLocationZipInput('');
  }, [initialState]);

  useEffect(() => {
    if (!data) return;
    if (data.role === 'agent') {
      const needsDetails =
        !data.phone?.trim() ||
        (data.statesLicensed?.length ?? 0) === 0 ||
        (data.coverageAreas?.length ?? 0) === 0;
      setIsEditing(needsDetails);
      return;
    }

    if (data.role === 'mc') {
      const needsDetails = !data.phone?.trim() || (data.licensedStates?.length ?? 0) === 0;
      setIsEditing(needsDetails);
      return;
    }

    setIsEditing(false);
  }, [data]);

  type TextField = Exclude<keyof FormState, 'coverageLocations' | 'specialties' | 'languages'>;

  const handleChange = (field: TextField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (field === 'phone') {
      const formatted = formatPhoneInput(event.target.value);
      setForm((previous) => ({ ...previous, phone: formatted }));
      return;
    }
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  const handleSelectChange = (field: 'specialties' | 'languages') => (
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    setForm((previous) => ({ ...previous, [field]: selected }));
  };

  if (!data) {
    return <div className="rounded-lg bg-white p-6 shadow-sm">Loading profile…</div>;
  }

  const parseList = (value: string, transform?: (value: string) => string) =>
    value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (transform ? transform(entry) : entry));

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

  const handleManualCoverageAdd = () => {
    const label = manualLocationLabel.trim();
    const zipInput = manualLocationZipInput.trim();

    if (!label) {
      toast.error('Add a city, town, or county name first.');
      return;
    }

    const zipCodes = zipInput
      .split(/[,\s]+/)
      .map((value) => normalizeZipCode(value))
      .filter((zip: string | null): zip is string => Boolean(zip));

    if (zipCodes.length === 0) {
      toast.error('Provide at least one ZIP code for the location.');
      return;
    }

    addCoverageLocations([{ label, zipCodes }]);
    setManualLocationLabel('');
    setManualLocationZipInput('');
  };

  const generateCoverageLocations = async () => {
    const description = form.coverageDescription.trim();
    if (!description) {
      toast.error('Describe the areas you cover first.');
      return;
    }

    setIsGeneratingCoverage(true);
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

      toast.success('Coverage locations added to your profile.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to generate coverage locations');
    } finally {
      setIsGeneratingCoverage(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (data.role !== 'agent' && data.role !== 'mc') {
      toast.info('Only agent and MC profiles can be edited here.');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
      };

      if (data.role === 'agent') {
        const normalizedCoverageLocations = mergeCoverageLocations([], form.coverageLocations);
        const coverageZipCodes = deriveZipCodes(normalizedCoverageLocations);
        payload.statesLicensed = parseList(form.states, (value) => value.toUpperCase());
        payload.coverageAreas = coverageZipCodes;
        payload.coverageLocations = normalizedCoverageLocations;
        payload.markets = parseList(form.markets);
        payload.licenseNumber = form.licenseNumber.trim();
        payload.brokerage = form.brokerage.trim();
        payload.specialties = form.specialties;
        payload.languages = form.languages;

        const experienceValue = form.experienceSince.trim();
        if (experienceValue) {
          const parsedDate = parseISO(experienceValue);
          if (Number.isNaN(parsedDate.getTime())) {
            throw new Error('Experience start date must be a valid date.');
          }
          payload.experienceSince = parsedDate.toISOString();
        } else {
          payload.experienceSince = null;
        }
      }

      if (data.role === 'mc') {
        payload.licensedStates = parseList(form.states, (value) => value.toUpperCase());
      }

      const response = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Unable to update profile');
      }

      toast.success('Profile updated');
      await mutate();
      setIsEditing(false);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update profile');
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = () => {
    setForm(initialState);
    setManualLocationLabel('');
    setManualLocationZipInput('');
    setIsEditing(false);
  };

  const renderBadgeList = (values: string[] | undefined, emptyLabel = 'Not provided') => {
    if (!values || values.length === 0) {
      return <p className="text-sm text-slate-500">{emptyLabel}</p>;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {values.map((item) => (
          <span
            key={item}
            className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
          >
            {item}
          </span>
        ))}
      </div>
    );
  };

  const readOnlyAgent = (profile: AgentProfileResponse) => {
    const yearsExperience = profile.experienceSince
      ? Math.max(differenceInYears(new Date(), new Date(profile.experienceSince)), 0)
      : null;
    const yearsExperienceLabel =
      yearsExperience === null
        ? 'Not provided'
        : `${yearsExperience} ${yearsExperience === 1 ? 'year' : 'years'}`;

    return (
      <div className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Contact & basics</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Name</p>
              <p className="mt-1 text-base font-semibold text-slate-900">{profile.name}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Email</p>
              <p className="mt-1 text-base font-medium text-slate-900">{profile.email}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Phone</p>
              <p className="mt-1 text-base font-medium text-slate-900">
                {profile.phone ? profile.phone : 'Not provided'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Brokerage</p>
              <p className="mt-1 text-base font-medium text-slate-900">
                {profile.brokerage ? profile.brokerage : 'Not provided'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">License number</p>
              <p className="mt-1 text-base font-medium text-slate-900">
                {profile.licenseNumber ? profile.licenseNumber : 'Not provided'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Years of experience</p>
              <p className="mt-1 text-base font-medium text-slate-900">{yearsExperienceLabel}</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Coverage & markets</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Licensed states</p>
              <div className="mt-2">{renderBadgeList(profile.statesLicensed?.map((state) => state.toUpperCase()))}</div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Areas covered</p>
              <div className="mt-2">
                {renderBadgeList(profile.coverageLocations?.map((location) => location.label))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">Specialties</p>
              <div className="mt-2">{renderBadgeList(profile.specialties)}</div>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">Languages</p>
              <div className="mt-2">{renderBadgeList(profile.languages, 'No languages listed')}</div>
            </div>
          </div>
        </section>
      </div>
    );
  };

  const readOnlyMc = (profile: McProfileResponse) => (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Contact & basics</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Name</p>
            <p className="mt-1 text-base font-semibold text-slate-900">{profile.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Email</p>
            <p className="mt-1 text-base font-medium text-slate-900">{profile.email}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Phone</p>
            <p className="mt-1 text-base font-medium text-slate-900">
              {profile.phone ? profile.phone : 'Not provided'}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Licensed states</h2>
        <div>{renderBadgeList(profile.licensedStates?.map((state) => state.toUpperCase()))}</div>
      </section>
    </div>
  );

  const readOnlyAdmin = (profile: AdminProfileResponse) => (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">Name</p>
        <p className="mt-1 text-base font-semibold text-slate-900">{profile.name ?? 'Not provided'}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">Email</p>
        <p className="mt-1 text-base font-medium text-slate-900">{profile.email ?? 'Not provided'}</p>
      </div>
      <p className="text-sm text-slate-500">Admin profiles are managed by the Referral CRM team.</p>
    </div>
  );

  const canEdit = data.role === 'agent' || data.role === 'mc';

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">Referral CRM</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">My profile</h1>
        </div>
        {canEdit && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Edit profile
          </button>
        )}
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit} className="mt-6 space-y-8">
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Contact & basics</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-600">
                Name
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange('name')}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                  required
                  disabled={saving}
                />
              </label>
              <label className="text-sm font-semibold text-slate-600">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={handleChange('email')}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                  required
                  disabled={saving}
                />
              </label>
              <label className="text-sm font-semibold text-slate-600">
                Phone
                <input
                  type="tel"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                  placeholder="(555) 123-4567"
                  disabled={saving}
                />
              </label>
            </div>
          </section>

          {data.role === 'agent' && (
            <>
              <section className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Coverage & licensing</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-600">
                    Brokerage
                    <input
                      type="text"
                      value={form.brokerage}
                      onChange={handleChange('brokerage')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      disabled={saving}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-600">
                    License number
                    <input
                      type="text"
                      value={form.licenseNumber}
                      onChange={handleChange('licenseNumber')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      disabled={saving}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-600 sm:col-span-2">
                    Licensed states
                    <textarea
                      value={form.states}
                      onChange={handleChange('states')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="CO, UT, AZ"
                      rows={2}
                      disabled={saving}
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <label htmlFor="profile-coverage-description" className="text-sm font-semibold text-slate-600">
                      Areas covered
                    </label>
                    <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-4">
                      <textarea
                        id="profile-coverage-description"
                        value={form.coverageDescription}
                        onChange={handleChange('coverageDescription')}
                        className="w-full flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40 sm:min-h-[7.25rem]"
                        placeholder="Describe neighborhoods, cities, and counties you serve"
                        rows={3}
                        disabled={saving || isGeneratingCoverage}
                      />
                      <button
                        type="button"
                        onClick={generateCoverageLocations}
                        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-70 sm:h-full sm:self-stretch"
                        disabled={saving || isGeneratingCoverage}
                      >
                        {isGeneratingCoverage ? 'Generating…' : 'Save Service Areas'}
                      </button>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-sm font-semibold text-slate-600">Cities, towns & counties</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {form.coverageLocations.length === 0 ? (
                        <p className="text-sm text-slate-500">No coverage locations added yet.</p>
                      ) : (
                        form.coverageLocations.map((location) => (
                          <span
                            key={location.label}
                            className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                          >
                            {location.label}
                            <button
                              type="button"
                              onClick={() => removeCoverageLocation(location.label)}
                              className="text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                              aria-label={`Remove ${location.label}`}
                              disabled={saving}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
                      <input
                        type="text"
                        value={manualLocationLabel}
                        onChange={(event) => setManualLocationLabel(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handleManualCoverageAdd();
                          }
                        }}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                        placeholder="Add a city, town, or county"
                        disabled={saving}
                      />
                      <input
                        type="text"
                        value={manualLocationZipInput}
                        onChange={(event) => setManualLocationZipInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handleManualCoverageAdd();
                          }
                        }}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                        placeholder="Associated ZIP codes (e.g. 78701, 78702)"
                        disabled={saving}
                        inputMode="text"
                      />
                      <button
                        type="button"
                        onClick={handleManualCoverageAdd}
                        className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-70 sm:self-stretch"
                        disabled={
                          saving ||
                          manualLocationLabel.trim().length === 0 ||
                          manualLocationZipInput.trim().length === 0
                        }
                      >
                        Add location
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Experience, specialties & languages
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-600">
                    Experience start date
                    <input
                      type="date"
                      value={form.experienceSince}
                      onChange={handleChange('experienceSince')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      disabled={saving}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-600 sm:col-span-2">
                    Specialties
                    <select
                      multiple
                      value={form.specialties}
                      onChange={handleSelectChange('specialties')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      size={6}
                      disabled={saving}
                    >
                      {AGENT_SPECIALTY_OPTIONS.map((specialty) => (
                        <option key={specialty} value={specialty}>
                          {specialty}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Hold Ctrl (Windows) or Command (Mac) to select multiple specialties.
                    </span>
                  </label>
                  <label className="text-sm font-semibold text-slate-600 sm:col-span-2">
                    Languages spoken
                    <select
                      multiple
                      value={form.languages}
                      onChange={handleSelectChange('languages')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      size={5}
                      disabled={saving}
                    >
                      {AGENT_LANGUAGE_OPTIONS.map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Hold Ctrl (Windows) or Command (Mac) to select multiple languages.
                    </span>
                  </label>
                </div>
              </section>

            </>
          )}

          {data.role === 'mc' && (
            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Licensed states</h2>
              <textarea
                value={form.states}
                onChange={handleChange('states')}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                placeholder="CO, UT, AZ"
                rows={2}
                disabled={saving}
              />
            </section>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={cancelEditing}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !canEdit}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-6">
          {data.role === 'agent' && readOnlyAgent(data)}
          {data.role === 'mc' && readOnlyMc(data)}
          {data.role === 'admin' && readOnlyAdmin(data)}
        </div>
      )}
    </div>
  );
}

