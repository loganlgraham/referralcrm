import { cn } from '@/lib/cn';

interface AvatarProps {
  name?: string | null;
  email?: string | null;
  size?: 'sm' | 'md' | 'lg';
  highlighted?: boolean;
  className?: string;
}

const sizeStyles: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm'
};

function getInitials(name?: string | null, email?: string | null): string {
  const source = (name ?? email ?? '').trim();
  if (!source) return '??';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export function Avatar({ name, email, size = 'md', highlighted = false, className }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-semibold text-foreground-muted ring-1 ring-inset ring-border',
        highlighted && 'bg-primary-soft text-primary ring-primary/20',
        sizeStyles[size],
        className
      )}
    >
      {getInitials(name, email)}
    </span>
  );
}
