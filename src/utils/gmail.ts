/**
 * Builds a Gmail web compose URL that opens a new compose window with the given recipient.
 * Opens in a new tab; recipient only (no subject/body prefill).
 */
export function buildGmailComposeUrl(to: string): string {
  const params = new URLSearchParams();
  params.set('view', 'cm');
  params.set('fs', '1');
  params.set('to', to.trim());
  return `https://mail.google.com/mail/?${params.toString()}`;
}
