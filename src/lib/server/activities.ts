import { Types } from 'mongoose';

import { Activity } from '@/models/activity';

type ActivityActor = 'Agent' | 'MC' | 'System';
export type ActivityChannel = 'call' | 'sms' | 'email' | 'note' | 'status' | 'update';

const isObjectIdString = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }
  return Types.ObjectId.isValid(value);
};

export const resolveActivityActor = (role: string | null | undefined): ActivityActor => {
  if (role === 'agent') {
    return 'Agent';
  }
  if (role === 'mc' || role === 'manager' || role === 'admin') {
    return 'MC';
  }
  return 'System';
};

interface LogReferralActivityOptions {
  referralId: Types.ObjectId | string;
  actorRole: string | null | undefined;
  actorId?: Types.ObjectId | string | null;
  channel: ActivityChannel;
  content: string;
}

export async function logReferralActivity({
  referralId,
  actorRole,
  actorId,
  channel,
  content,
}: LogReferralActivityOptions) {
  const actor = resolveActivityActor(actorRole);
  const normalizedReferralId =
    typeof referralId === 'string' && isObjectIdString(referralId)
      ? new Types.ObjectId(referralId)
      : referralId;

  const normalizedActorId =
    typeof actorId === 'string'
      ? isObjectIdString(actorId)
        ? new Types.ObjectId(actorId)
        : undefined
      : actorId ?? undefined;

  await Activity.create({
    referralId: normalizedReferralId,
    actor,
    actorId: normalizedActorId,
    channel,
    content,
  });
}
