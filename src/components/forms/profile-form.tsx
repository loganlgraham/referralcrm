'use client';

import { ChangeEvent, CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { differenceInYears, parseISO } from 'date-fns';

import { fetcher } from '@/utils/fetcher';
import { AGENT_LANGUAGE_OPTIONS, AGENT_SPECIALTY_OPTIONS } from '@/constants/agent-options';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FieldGrid, FieldGroup, FieldLabel, selectFieldClasses } from '@/components/ui/field-group';

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
  nmlsId: string;
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
  nmlsId: string;
  markets: string;
  experienceSince: string;
  specialties: string[];
  languages: string[];
};

type AgentProfilePayload = {
  name: string;
  email: string;
  phone: string;
  statesLicensed: string[];
  coverageAreas: string[];
  coverageLocations: CoverageLocation[];
  markets: string[];
  licenseNumber: string;
  brokerage: string;
  specialties: string[];
  languages: string[];
  experienceSince: string | null;
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
        nmlsId: '',
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
        nmlsId: '',
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
        nmlsId: data.nmlsId ?? '',
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
        nmlsId: '',
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
  const [coverageProgress, setCoverageProgress] = useState(0);
  const [isPersistingCoverage, setIsPersistingCoverage] = useState(false);

  useEffect(() => {
    setForm(initialState);
  }, [initialState]);

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
      const needsDetails =
        !data.phone?.trim() ||
        !data.nmlsId?.trim() ||
        (data.licensedStates?.length ?? 0) === 0;
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
    return (
      <div className="rounded-card border border-border bg-surface-raised p-4 text-sm text-foreground-muted shadow-card">
        Loading profile…
      </div>
    );
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

  const createAgentPatchPayload = (coverageLocations: CoverageLocation[]): AgentProfilePayload => {
    const normalizedCoverageLocations = mergeCoverageLocations([], coverageLocations);
    const coverageZipCodes = deriveZipCodes(normalizedCoverageLocations);

    const payload: AgentProfilePayload = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      statesLicensed: parseList(form.states, (value) => value.toUpperCase()),
      coverageAreas: coverageZipCodes,
      coverageLocations: normalizedCoverageLocations,
      markets: parseList(form.markets),
      licenseNumber: form.licenseNumber.trim(),
      brokerage: form.brokerage.trim(),
      specialties: form.specialties,
      languages: form.languages,
      experienceSince: null,
    };

    const experienceValue = form.experienceSince.trim();
    if (experienceValue) {
      const parsedDate = parseISO(experienceValue);
      if (Number.isNaN(parsedDate.getTime())) {
        throw new Error('Experience start date must be a valid date.');
      }
      payload.experienceSince = parsedDate.toISOString();
    }

    return payload;
  };

  const persistCoverageUpdate = async (
    mergedLocations: CoverageLocation[],
    successMessage: string
  ) => {
    if (data.role !== 'agent') {
      toast.success(successMessage);
      return;
    }

    setIsPersistingCoverage(true);
    try {
      const payload = createAgentPatchPayload(mergedLocations);
      const response = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : payload?.error?.message ??
              payload?.message ??
              'Unable to save generated coverage areas.';
        throw new Error(message);
      }

      toast.success(successMessage);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Unable to save generated coverage areas.'
      );
    } finally {
      setIsPersistingCoverage(false);
    }
  };

  const applyCoverageWithPersistence = async (
    incoming: CoverageLocation[],
    successMessage: string
  ) => {
    if (incoming.length === 0) {
      return;
    }

    let mergedLocations: CoverageLocation[] = [];
    setForm((previous) => {
      const nextLocations = mergeCoverageLocations(previous.coverageLocations, incoming);
      mergedLocations = nextLocations;
      return { ...previous, coverageLocations: nextLocations };
    });

    await persistCoverageUpdate(mergedLocations, successMessage);
  };

  const generateCoverageLocations = async () => {
    const description = form.coverageDescription.trim();
    if (!description) {
      toast.error('Describe the areas you cover first.');
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

        await applyCoverageWithPersistence(
          fallbackLocations,
          'ZIP codes saved as coverage placeholders.'
        );
        return;
      }

      await applyCoverageWithPersistence(
        normalizedLocations,
        'Coverage locations saved to your profile.'
      );
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

    if (data.role !== 'agent' && data.role !== 'mc') {
      toast.info('Only agent and MC profiles can be edited here.');
      return;
    }

    setSaving(true);
    try {
      const nmlsId = form.nmlsId.trim();
      const payload: Record<string, unknown> =
        data.role === 'agent'
          ? createAgentPatchPayload(form.coverageLocations)
          : {
              name: form.name.trim(),
              email: form.email.trim().toLowerCase(),
              phone: form.phone.trim(),
              nmlsId,
              licensedStates: parseList(form.states, (value) => value.toUpperCase()),
            };

      if (data.role === 'mc' && !nmlsId) {
        throw new Error('Please enter your NMLS ID.');
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
    setIsEditing(false);
  };

  const renderBadgeList = (values: string[] | undefined, emptyLabel = 'Not provided') => {
    if (!values || values.length === 0) {
      return <p className="text-sm text-foreground-subtle">{emptyLabel}</p>;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {values.map((item) => (
          <span
            key={item}
            className="inline-flex items-center rounded-full bg-surface-subtle px-3 py-1 text-xs font-medium text-foreground-muted"
          >
            {item}
          </span>
        ))}
      </div>
    );
  };

  const readOnlyValue = (value: string, numeric = false) => (
    <p
      className={cn(
        'mt-1 text-base font-medium text-foreground',
        numeric && 'text-numeric'
      )}
    >
      {value}
    </p>
  );

  const readOnlyAgent = (profile: AgentProfileResponse) => {
    const yearsExperience = profile.experienceSince
      ? Math.max(differenceInYears(new Date(), new Date(profile.experienceSince)), 0)
      : null;
    const yearsExperienceLabel =
      yearsExperience === null
        ? 'Not provided'
        : `${yearsExperience} ${yearsExperience === 1 ? 'year' : 'years'}`;

    return (
      <div className="space-y-5">
        <FieldGroup title="Contact & basics">
          <FieldGrid className="gap-y-4">
            <div>
              <p className="text-xs text-foreground-subtle">Name</p>
              <p className="mt-1 text-base font-semibold text-foreground">{profile.name}</p>
            </div>
            <div>
              <p className="text-xs text-foreground-subtle">Email</p>
              {readOnlyValue(profile.email)}
            </div>
            <div>
              <p className="text-xs text-foreground-subtle">Phone</p>
              {readOnlyValue(profile.phone || 'Not provided', Boolean(profile.phone))}
            </div>
            <div>
              <p className="text-xs text-foreground-subtle">Brokerage</p>
              {readOnlyValue(profile.brokerage || 'Not provided')}
            </div>
            <div>
              <p className="text-xs text-foreground-subtle">License number</p>
              {readOnlyValue(profile.licenseNumber || 'Not provided', Boolean(profile.licenseNumber))}
            </div>
            <div>
              <p className="text-xs text-foreground-subtle">Years of experience</p>
              {readOnlyValue(yearsExperienceLabel, yearsExperience !== null)}
            </div>
          </FieldGrid>
        </FieldGroup>

        <FieldGroup title="Coverage & markets">
          <FieldGrid className="gap-y-4">
            <div>
              <p className="text-xs text-foreground-subtle">Licensed states</p>
              <div className="mt-2">{renderBadgeList(profile.statesLicensed?.map((state) => state.toUpperCase()))}</div>
            </div>
            <div>
              <p className="text-xs text-foreground-subtle">Areas covered</p>
              <div className="mt-2">
                {renderBadgeList(profile.coverageLocations?.map((location) => location.label))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-foreground-subtle">Specialties</p>
              <div className="mt-2">{renderBadgeList(profile.specialties)}</div>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-foreground-subtle">Languages</p>
              <div className="mt-2">{renderBadgeList(profile.languages, 'No languages listed')}</div>
            </div>
          </FieldGrid>
        </FieldGroup>
      </div>
    );
  };

  const readOnlyMc = (profile: McProfileResponse) => (
    <div className="space-y-5">
      <FieldGroup title="Contact & basics">
        <FieldGrid className="gap-y-4">
          <div>
            <p className="text-xs text-foreground-subtle">Name</p>
            <p className="mt-1 text-base font-semibold text-foreground">{profile.name}</p>
          </div>
          <div>
            <p className="text-xs text-foreground-subtle">Email</p>
            {readOnlyValue(profile.email)}
          </div>
          <div>
            <p className="text-xs text-foreground-subtle">Phone</p>
            {readOnlyValue(profile.phone || 'Not provided', Boolean(profile.phone))}
          </div>
          <div>
            <p className="text-xs text-foreground-subtle">NMLS ID</p>
            {readOnlyValue(profile.nmlsId || 'Not provided', Boolean(profile.nmlsId))}
          </div>
        </FieldGrid>
      </FieldGroup>

      <FieldGroup title="Licensed states">
        {renderBadgeList(profile.licensedStates?.map((state) => state.toUpperCase()))}
      </FieldGroup>
    </div>
  );

  const readOnlyAdmin = (profile: AdminProfileResponse) => (
    <FieldGroup
      title="Contact & basics"
      description="Admin profiles are managed by the Referral CRM team."
    >
      <FieldGrid className="gap-y-4">
        <div>
          <p className="text-xs text-foreground-subtle">Name</p>
          <p className="mt-1 text-base font-semibold text-foreground">{profile.name ?? 'Not provided'}</p>
        </div>
        <div>
          <p className="text-xs text-foreground-subtle">Email</p>
          {readOnlyValue(profile.email ?? 'Not provided')}
        </div>
      </FieldGrid>
    </FieldGroup>
  );

  const canEdit = data.role === 'agent' || data.role === 'mc';

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Account"
        title="My profile"
        description="Keep your contact details and coverage current so the team can route work to you."
        actions={
          canEdit && !isEditing ? (
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              Edit profile
            </Button>
          ) : null
        }
      />

      {isEditing ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          <FieldGroup title="Contact & basics">
            <FieldGrid>
              <label className="block space-y-1.5">
                <FieldLabel label="Name" />
                <Input
                  type="text"
                  value={form.name}
                  onChange={handleChange('name')}
                  required
                  disabled={saving}
                />
              </label>
              <label className="block space-y-1.5">
                <FieldLabel label="Email" />
                <Input
                  type="email"
                  value={form.email}
                  onChange={handleChange('email')}
                  required
                  disabled={saving}
                />
              </label>
              <label className="block space-y-1.5">
                <FieldLabel label="Phone" />
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  className="text-numeric"
                  placeholder="555-123-4567"
                  disabled={saving}
                />
              </label>
              {data.role === 'mc' && (
                <label className="block space-y-1.5">
                  <FieldLabel label="NMLS ID" />
                  <Input
                    type="text"
                    value={form.nmlsId}
                    onChange={handleChange('nmlsId')}
                    className="text-numeric"
                    placeholder="123456"
                    disabled={saving}
                    required
                  />
                </label>
              )}
            </FieldGrid>
          </FieldGroup>

          {data.role === 'agent' && (
            <>
              <FieldGroup title="Coverage & licensing">
                <FieldGrid>
                  <label className="block space-y-1.5">
                    <FieldLabel label="Brokerage" />
                    <Input
                      type="text"
                      value={form.brokerage}
                      onChange={handleChange('brokerage')}
                      disabled={saving}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <FieldLabel label="License number" />
                    <Input
                      type="text"
                      value={form.licenseNumber}
                      onChange={handleChange('licenseNumber')}
                      className="text-numeric"
                      disabled={saving}
                    />
                  </label>
                  <label className="block space-y-1.5 sm:col-span-2">
                    <FieldLabel label="Licensed states" />
                    <Textarea
                      value={form.states}
                      onChange={handleChange('states')}
                      placeholder="CO, UT, AZ"
                      rows={2}
                      disabled={saving}
                    />
                  </label>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label htmlFor="profile-coverage-description" className="block">
                      <FieldLabel label="Areas covered" />
                    </label>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-4">
                      <Textarea
                        id="profile-coverage-description"
                        value={form.coverageDescription}
                        onChange={handleChange('coverageDescription')}
                        className="flex-1 sm:min-h-[5.5rem]"
                        placeholder="Describe neighborhoods, cities, and counties you serve"
                        rows={3}
                        disabled={saving || isGeneratingCoverage || isPersistingCoverage}
                      />
                      <Button
                        onClick={generateCoverageLocations}
                        className="shrink-0 sm:h-auto sm:min-h-[5.5rem] sm:self-stretch"
                        style={coverageButtonStyles}
                        disabled={saving || isPersistingCoverage}
                        loading={isGeneratingCoverage}
                      >
                        {isGeneratingCoverage ? 'Generating…' : 'Save service areas'}
                      </Button>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-sm font-medium text-foreground">Cities, towns & counties</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {form.coverageLocations.length === 0 ? (
                        <p className="text-sm text-foreground-subtle">No coverage locations added yet.</p>
                      ) : (
                        form.coverageLocations.map((location) => (
                          <span
                            key={location.label}
                            className="inline-flex items-center gap-2 rounded-full bg-surface-subtle px-3 py-1 text-xs font-medium text-foreground-muted"
                          >
                            {location.label}
                            <button
                              type="button"
                              onClick={() => removeCoverageLocation(location.label)}
                              className="text-foreground-subtle transition hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                              aria-label={`Remove ${location.label}`}
                              disabled={saving || isPersistingCoverage}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </FieldGrid>
              </FieldGroup>

              <FieldGroup title="Experience, specialties & languages">
                <FieldGrid>
                  <label className="block space-y-1.5">
                    <FieldLabel label="Experience start date" />
                    <Input
                      type="date"
                      value={form.experienceSince}
                      onChange={handleChange('experienceSince')}
                      className="text-numeric"
                      disabled={saving}
                    />
                  </label>
                  <label className="block space-y-1.5 sm:col-span-2">
                    <FieldLabel
                      label="Specialties"
                      hint="Hold Ctrl or Command to select several"
                    />
                    <select
                      multiple
                      value={form.specialties}
                      onChange={handleSelectChange('specialties')}
                      className={cn(selectFieldClasses, 'h-auto py-2')}
                      size={6}
                      disabled={saving}
                    >
                      {AGENT_SPECIALTY_OPTIONS.map((specialty) => (
                        <option key={specialty} value={specialty}>
                          {specialty}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5 sm:col-span-2">
                    <FieldLabel
                      label="Languages spoken"
                      hint="Hold Ctrl or Command to select several"
                    />
                    <select
                      multiple
                      value={form.languages}
                      onChange={handleSelectChange('languages')}
                      className={cn(selectFieldClasses, 'h-auto py-2')}
                      size={5}
                      disabled={saving}
                    >
                      {AGENT_LANGUAGE_OPTIONS.map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                  </label>
                </FieldGrid>
              </FieldGroup>
            </>
          )}

          {data.role === 'mc' && (
            <FieldGroup title="Licensed states">
              <Textarea
                value={form.states}
                onChange={handleChange('states')}
                placeholder="CO, UT, AZ"
                rows={2}
                disabled={saving}
              />
            </FieldGroup>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="secondary" onClick={cancelEditing} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canEdit} loading={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {data.role === 'agent' && readOnlyAgent(data)}
          {data.role === 'mc' && readOnlyMc(data)}
          {data.role === 'admin' && readOnlyAdmin(data)}
        </>
      )}
    </div>
  );
}

