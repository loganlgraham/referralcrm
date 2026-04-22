import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Label } from '@/components/ui/label';

interface FieldProps {
  id?: string;
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({
  id,
  label,
  description,
  error,
  hint,
  required,
  className,
  children
}: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      )}
      {description && <p className="text-xs text-foreground-muted">{description}</p>}
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-foreground-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
