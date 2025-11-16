'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PersonDeleteSectionProps {
  id: string;
  label: string;
  endpoint: string;
  redirectPath: string;
  details?: string;
}

export function PersonDeleteSection({
  id,
  label,
  endpoint,
  redirectPath,
  details,
}: PersonDeleteSectionProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    const confirmed = window.confirm(
      `Delete this ${label}? This action cannot be undone and will remove their account access.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    const response = await fetch(`${endpoint}/${id}`, { method: 'DELETE' });

    if (!response.ok) {
      setIsDeleting(false);
      setError('Failed to delete. Please try again.');
      return;
    }

    router.push(redirectPath);
    router.refresh();
  };

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
      <h3 className="text-base font-semibold text-red-900">Delete {label}</h3>
      <p className="mt-1 text-red-700">
        {details ?? 'Deleting will remove this profile and sign-in access. This cannot be undone.'}
      </p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        className="mt-4 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:opacity-60"
        onClick={handleDelete}
        disabled={isDeleting}
      >
        {isDeleting ? 'Deleting…' : `Delete ${label}`}
      </button>
    </div>
  );
}
