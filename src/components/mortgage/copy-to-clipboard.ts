import { toast } from 'sonner';

/**
 * Copies text and reports what actually happened. The Clipboard API rejects on
 * insecure origins and when the browser denies permission, so the confirmation
 * has to follow the write instead of assuming it succeeded.
 */
export async function copyToClipboard(
  text: string,
  success: { title: string; description?: string }
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(
      success.title,
      success.description ? { description: success.description } : undefined
    );
  } catch {
    toast.error('Could not copy to your clipboard', {
      description: 'Your browser blocked the copy. Select the text and copy it manually.',
    });
  }
}
