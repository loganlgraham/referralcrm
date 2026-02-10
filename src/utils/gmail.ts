/**
 * Builds a Gmail web compose URL that opens a new compose window with the given recipient.
 * Opens in a new tab. Optional cc, subject, and body can be provided.
 */
export function buildGmailComposeUrl(
  to: string,
  options?: { cc?: string; subject?: string; body?: string }
): string {
  const params = new URLSearchParams();
  params.set('view', 'cm');
  params.set('fs', '1');
  params.set('to', to.trim());
  if (options?.cc) params.set('cc', options.cc.trim());
  if (options?.subject) params.set('su', options.subject);
  if (options?.body) params.set('body', options.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}
