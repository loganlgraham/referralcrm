'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { fetcher } from '@/utils/fetcher';

interface AgentProfileResponse {
  role: 'agent';
  _id: string;
  name: string;
  email: string;
  phone: string;
  statesLicensed: string[];
  coverageAreas: string[];
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

export function ProfileForm() {
  const { data, mutate } = useSWR<ProfileResponse>('/api/me/profile', fetcher);
  const [saving, setSaving] = useState(false);

  const initialState = useMemo(() => {
    if (!data) {
      return {
        name: '',
        email: '',
        phone: '',
        states: '',
        coverage: '',
      };
    }

    if (data.role === 'agent') {
      return {
        name: data.name,
        email: data.email,
        phone: data.phone ?? '',
        states: (data.statesLicensed ?? []).join(', '),
        coverage: (data.coverageAreas ?? []).join(', '),
      };
    }

    if (data.role === 'mc') {
      return {
        name: data.name,
        email: data.email,
        phone: data.phone ?? '',
        states: (data.licensedStates ?? []).join(', '),
        coverage: '',
      };
    }

    return {
      name: data.name ?? '',
      email: data.email ?? '',
      phone: '',
      states: '',
      coverage: '',
    };
  }, [data]);

  const [form, setForm] = useState(initialState);

  useEffect(() => {
    setForm(initialState);
  }, [initialState]);

  const handleChange = (field: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  if (!data) {
    return <div className="rounded-lg bg-white p-6 shadow-sm">Loading profile…</div>;
  }

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
        payload.statesLicensed = form.states
          .split(',')
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean);
        payload.coverageAreas = form.coverage
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
      }

      if (data.role === 'mc') {
        payload.licensedStates = form.states
          .split(',')
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean);
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
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg bg-white p-6 shadow-sm">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My profile</h1>
        <p className="text-sm text-slate-500">Update your contact information so teammates can reach you.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-slate-600">
          Name
          <input
            type="text"
            value={form.name}
            onChange={handleChange('name')}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
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
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
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
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
            placeholder="(555) 123-4567"
            disabled={saving}
          />
        </label>
        {data.role === 'agent' && (
          <label className="text-sm font-semibold text-slate-600">
            Areas covered (zip, city, or county)
            <input
              type="text"
              value={form.coverage}
              onChange={handleChange('coverage')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="Denver, 80202, Jefferson County"
              disabled={saving}
            />
          </label>
        )}
        {(data.role === 'agent' || data.role === 'mc') && (
          <label className="text-sm font-semibold text-slate-600 md:col-span-2">
            Licensed states (comma separated)
            <input
              type="text"
              value={form.states}
              onChange={handleChange('states')}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              placeholder="CO, UT"
              disabled={saving}
            />
          </label>
        )}
      </div>

      <button
        type="submit"
        disabled={saving || (data.role !== 'agent' && data.role !== 'mc')}
        className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
      >
        {saving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
