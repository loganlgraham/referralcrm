'use client';

import { ChangeEvent, FormEvent, useEffect, useId, useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { differenceInYears, parseISO } from 'date-fns';

import { fetcher } from '@/utils/fetcher';
import { useCoverageSuggestions } from '@/hooks/use-coverage-suggestions';

interface AgentProfileResponse {
  role: 'agent';
  _id: string;
  name: string;
  email: string;
  phone: string;
  statesLicensed: string[];
  coverageAreas: string[];
  licenseNumber?: string;
  brokerage?: string;
  markets?: string[];
  closings12mo?: number;
  closingRatePercentage?: number | null;
  npsScore?: number | null;
  avgResponseHours?: number | null;
  experienceSince?: string | null;
  specialties?: string[];
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
  coverage: string;
  licenseNumber: string;
  brokerage: string;
  markets: string;
  closings12mo: string;
  closingRatePercentage: string;
  avgResponseHours: string;
  npsScore: string;
  experienceSince: string;
  specialties: string;
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
  const { suggestions } = useCoverageSuggestions();
  const datalistId = useId();

  const initialState = useMemo<FormState>(() => {
    if (!data) {
      return {
        name: '',
        email: '',
        phone: '',
        states: '',
        coverage: '',
        licenseNumber: '',
        brokerage: '',
        markets: '',
        closings12mo: '',
        closingRatePercentage: '',
        avgResponseHours: '',
        npsScore: '',
        experienceSince: '',
        specialties: '',
      };
    }

    if (data.role === 'agent') {
      return {
        name: data.name,
        email: data.email,
        phone: data.phone ?? '',
        states: (data.statesLicensed ?? []).join(', '),
        coverage: (data.coverageAreas ?? []).join(', '),
        licenseNumber: data.licenseNumber ?? '',
        brokerage: data.brokerage ?? '',
        markets: (data.markets ?? []).join(', '),
        closings12mo: typeof data.closings12mo === 'number' ? String(data.closings12mo) : '',
        closingRatePercentage:
          typeof data.closingRatePercentage === 'number' ? String(data.closingRatePercentage) : '',
        avgResponseHours: typeof data.avgResponseHours === 'number' ? String(data.avgResponseHours) : '',
        npsScore: typeof data.npsScore === 'number' ? String(data.npsScore) : '',
        experienceSince: data.experienceSince ? data.experienceSince.slice(0, 10) : '',
        specialties: (data.specialties ?? []).join(', '),
      };
    }

    if (data.role === 'mc') {
      return {
        name: data.name,
        email: data.email,
        phone: data.phone ?? '',
        states: (data.licensedStates ?? []).join(', '),
        coverage: '',
        licenseNumber: '',
        brokerage: '',
        markets: '',
        closings12mo: '',
        closingRatePercentage: '',
        avgResponseHours: '',
        npsScore: '',
        experienceSince: '',
        specialties: '',
      };
    }

    return {
      name: data.name ?? '',
      email: data.email ?? '',
      phone: '',
      states: '',
      coverage: '',
      licenseNumber: '',
      brokerage: '',
      markets: '',
      closings12mo: '',
      closingRatePercentage: '',
      avgResponseHours: '',
      npsScore: '',
      experienceSince: '',
      specialties: '',
    };
  }, [data]);

  const [form, setForm] = useState<FormState>(initialState);
  const [isEditing, setIsEditing] = useState(true);

  useEffect(() => {
    setForm(initialState);
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

  const handleChange = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (field === 'phone') {
      const formatted = formatPhoneInput(event.target.value);
      setForm((previous) => ({ ...previous, phone: formatted }));
      return;
    }
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
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
        payload.statesLicensed = parseList(form.states, (value) => value.toUpperCase());
        payload.coverageAreas = parseList(form.coverage);
        payload.markets = parseList(form.markets);
        payload.licenseNumber = form.licenseNumber.trim();
        payload.brokerage = form.brokerage.trim();

        const closingsValue = form.closings12mo.trim();
        if (closingsValue) {
          const parsed = Number(closingsValue);
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw new Error('Closings (last 12 months) must be a positive number.');
          }
          payload.closings12mo = Math.round(parsed);
        } else {
          payload.closings12mo = 0;
        }

        const closingRateValue = form.closingRatePercentage.trim();
        if (closingRateValue) {
          const parsed = Number(closingRateValue);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
            throw new Error('Closing rate should be between 0 and 100%.');
          }
          payload.closingRatePercentage = Number(parsed.toFixed(1));
        } else {
          payload.closingRatePercentage = null;
        }

        const responseHoursValue = form.avgResponseHours.trim();
        if (responseHoursValue) {
          const parsed = Number(responseHoursValue);
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw new Error('Average response time must be zero or greater.');
          }
          payload.avgResponseHours = Number(parsed.toFixed(1));
        } else {
          payload.avgResponseHours = null;
        }

        const npsValue = form.npsScore.trim();
        if (npsValue) {
          const parsed = Number(npsValue);
          if (!Number.isFinite(parsed) || parsed < -100 || parsed > 100) {
            throw new Error('NPS score should fall between -100 and 100.');
          }
          payload.npsScore = Math.round(parsed);
        } else {
          payload.npsScore = null;
        }

        payload.specialties = parseList(form.specialties);

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
              <div className="mt-2">{renderBadgeList(profile.coverageAreas)}</div>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">Primary markets</p>
              <div className="mt-2">{renderBadgeList(profile.markets)}</div>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">Specialties</p>
              <div className="mt-2">{renderBadgeList(profile.specialties)}</div>
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
                  <label className="text-sm font-semibold text-slate-600">
                    Areas covered (zip, city, or county)
                    <input
                      type="text"
                      value={form.coverage}
                      onChange={handleChange('coverage')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="Denver, 80202, Jefferson County"
                      list={datalistId}
                      disabled={saving}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-600">
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
                  <label className="text-sm font-semibold text-slate-600 sm:col-span-2">
                    Primary markets (comma separated)
                    <textarea
                      value={form.markets}
                      onChange={handleChange('markets')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="Front Range, Boulder County, Summit County"
                      rows={2}
                      disabled={saving}
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Experience & specialties</h2>
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
                    Specialties (comma separated)
                    <textarea
                      value={form.specialties}
                      onChange={handleChange('specialties')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="First-time homebuyers, Relocation, Luxury"
                      rows={2}
                      disabled={saving}
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Performance metrics</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-600">
                    Closings (last 12 months)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form.closings12mo}
                      onChange={handleChange('closings12mo')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="24"
                      disabled={saving}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-600">
                    Closing rate (%)
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.1}
                      value={form.closingRatePercentage}
                      onChange={handleChange('closingRatePercentage')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="42.5"
                      disabled={saving}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-600">
                    Average response time (hours)
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.1}
                      value={form.avgResponseHours}
                      onChange={handleChange('avgResponseHours')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="2.5"
                      disabled={saving}
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-600">
                    NPS score
                    <input
                      type="number"
                      inputMode="numeric"
                      min={-100}
                      max={100}
                      value={form.npsScore}
                      onChange={handleChange('npsScore')}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
                      placeholder="68"
                      disabled={saving}
                    />
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

          {data.role === 'agent' && suggestions.length > 0 && (
            <datalist id={datalistId}>
              {suggestions.map((suggestion) => (
                <option key={suggestion.id} value={suggestion.value} />
              ))}
            </datalist>
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

