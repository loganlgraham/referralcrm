import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { canViewReferral, type ReferralAccess } from '@/lib/rbac';
import { Referral } from '@/models/referral';

export async function getAuthorizedIntakeMessage(referralId: string) {
  const session = await getCurrentSession();
  if (!session?.user || !Types.ObjectId.isValid(referralId)) return null;
  await connectMongo();
  const referral = await Referral.findOne({ _id: referralId, deletedAt: null })
    .select('org assignedAgent buySideAgent sellSideAgent lender inboundEmail.messageId')
    .populate('assignedAgent buySideAgent sellSideAgent lender', 'userId')
    .lean<ReferralAccess & { inboundEmail?: { messageId: string } }>();
  if (!referral || !canViewReferral(session, referral)) return null;
  return referral.inboundEmail?.messageId ?? null;
}
