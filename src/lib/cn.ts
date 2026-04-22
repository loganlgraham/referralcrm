import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Compose conditional class names and resolve Tailwind conflicts deterministically. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
