'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

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
    <div className="rounded-card border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      <h3 className="font-display text-base font-semibold tracking-[-0.02em] text-danger">Delete {label}</h3>
      <p className="mt-1 text-danger">
        {details ?? 'Deleting will remove this profile and sign-in access. This cannot be undone.'}
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <Button type="button" variant="danger" className="mt-4" onClick={handleDelete} loading={isDeleting}>
        {isDeleting ? 'Deleting…' : `Delete ${label}`}
      </Button>
    </div>
  );
}
