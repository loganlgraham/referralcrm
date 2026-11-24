import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { canViewReferral, type ReferralAccess } from '@/lib/rbac';
import { Referral } from '@/models/referral';

export async function GET(
  _request: Request,
  { params }: { params: { id: string; attachmentId: string } },
) {
  const session = await getCurrentSession();
  if (!session?.user) return new Response(null, { status: 401 });
  if (
    !Types.ObjectId.isValid(params.id) ||
    !/^[\w-]{1,128}$/.test(params.attachmentId)
  )
    return new Response(null, { status: 404 });
  await connectMongo();
  const referral = await Referral.findOne({ _id: params.id, deletedAt: null })
    .select(
      'org assignedAgent buySideAgent sellSideAgent lender inboundEmail.messageId',
    )
    .populate('assignedAgent buySideAgent sellSideAgent lender', 'userId')
    .lean<ReferralAccess & { inboundEmail?: { messageId: string } }>();
  if (
    !referral ||
    !canViewReferral(session, referral) ||
    !referral.inboundEmail?.messageId
  )
    return new Response(null, { status: 404 });
  const base =
    'https://api.resend.com/emails/receiving/' +
    encodeURIComponent(referral.inboundEmail.messageId);
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
