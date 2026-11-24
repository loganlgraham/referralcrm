import { getAuthorizedIntakeMessage } from '@/lib/server/referral-intake-files';

export async function GET(
  _request: Request,
  { params }: { params: { id: string; attachmentId: string } },
) {
  if (!/^[\w-]{1,128}$/.test(params.attachmentId)) return new Response(null, { status: 404 });
  const messageId = await getAuthorizedIntakeMessage(params.id);
  if (!messageId) return new Response(null, { status: 404 });
  const base =
    'https://api.resend.com/emails/receiving/' +
    encodeURIComponent(messageId);
  const metadata = await fetch(
    base + '/attachments/' + encodeURIComponent(params.attachmentId),
    {
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
      cache: 'no-store',
      redirect: 'error',
    },
  );
  if (!metadata.ok)
    return new Response('The original attachment is unavailable.', {
      status: metadata.status === 404 ? 404 : 503,
    });
  const payload = await metadata.json();
  const attachment = payload.data ?? payload;
  if (
    typeof attachment.download_url !== 'string' ||
    !attachment.download_url.startsWith('https://')
  )
    return new Response(null, { status: 503 });
  const file = await fetch(attachment.download_url, {
    cache: 'no-store',
    redirect: 'error',
  });
  if (!file.ok) return new Response(null, { status: 503 });
  const filename = String(attachment.filename || 'attachment').replace(
    /[^a-zA-Z0-9._ -]/g,
    '_',
  );
  return new Response(file.body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
