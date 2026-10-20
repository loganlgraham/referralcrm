'use client';

import { useEffect } from 'react';
import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Without this, a page that throws leaves the dashboard blank with nothing to
 * click. Here the shell survives, so the sidebar still works and the page can
 * be retried without a full reload.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard page failed to render', error);
  }, [error]);

  return (
    <EmptyState
      icon={<AlertTriangleIcon className="h-5 w-5" />}
      title="This page ran into a problem"
      description="Nothing was lost. Try loading it again, and if it keeps happening, let us know what you were doing."
      action={
        <Button
          variant="secondary"
          leadingIcon={<RotateCcwIcon className="h-4 w-4" />}
          onClick={reset}
        >
          Try again
        </Button>
      }
    />
  );
}
