/**
 * Grouping and ordering for the agent referral list. Pure so it can run on the
 * server during the initial render and again on the client after an optimistic
 * status change moves a row between groups.
 */

export type ReferralGroupId = 'waiting-on-you' | 'moving-along';

export interface ReferralGroup<T> {
  id: ReferralGroupId;
  label: string;
  items: T[];
}

export interface GroupableReferral {
  needsUpdate?: boolean;
  daysInStatus?: number;
}

export const REFERRAL_GROUP_LABELS: Record<ReferralGroupId, string> = {
  'waiting-on-you': 'Waiting on you',
  'moving-along': 'Moving along'
};

const byDaysInStatusDesc = (a: GroupableReferral, b: GroupableReferral): number =>
  (b.daysInStatus ?? 0) - (a.daysInStatus ?? 0);

/**
 * Group order is fixed: everything waiting on the agent first, then the rest.
 * Empty groups are returned too so callers can decide whether to render a
 * header; callers filter them out.
 */
export function groupReferralsForAgent<T extends GroupableReferral>(
  rows: readonly T[]
): ReferralGroup<T>[] {
  const waiting: T[] = [];
  const moving: T[] = [];

  for (const row of rows) {
    if (row.needsUpdate) {
      waiting.push(row);
    } else {
      moving.push(row);
    }
  }

  return [
    {
      id: 'waiting-on-you',
      label: REFERRAL_GROUP_LABELS['waiting-on-you'],
      items: waiting.sort(byDaysInStatusDesc)
    },
    {
      id: 'moving-along',
      label: REFERRAL_GROUP_LABELS['moving-along'],
      items: moving.sort(byDaysInStatusDesc)
    }
  ];
}
