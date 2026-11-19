import type { RemoteCustomer, RemoteResult } from '@/lib/intelligence/remote';

export type PanelLink = { personId: number; participantKey: string };

export type PanelActivity =
  | { status: 'not_requested' }
  | { status: 'not_found' }
  | { status: 'unavailable' }
  | { status: 'no_activity'; coverageDetail: string | null }
  | {
      status: 'ready';
      incomplete: boolean;
      latest: RemoteCustomer['latest'];
      followUp: RemoteCustomer['followUp'];
      fubAssignedUser: RemoteCustomer['fubAssignedUser'];
      projectedClosings: RemoteCustomer['projectedClosings'];
      referrioAgent: string | null;
      agentsDiffer: boolean;
      freshnessNote: string;
      coverageDetail: string | null;
    };

export type PanelResponse = {
  officialScoring: false;
  access: 'allowed' | 'denied';
  link: PanelLink | null;
  activity: PanelActivity;
  saved?: boolean;
};

export function deniedPanel(): PanelResponse {
  return { officialScoring: false, access: 'denied', link: null, activity: { status: 'not_requested' } };
}

export function savedPanel(personId: number | null, participantKey: string): PanelResponse {
  return {
    officialScoring: false,
    access: 'allowed',
    saved: true,
    link: personId ? { personId, participantKey } : null,
    activity: { status: 'not_requested' },
  };
}

/** The saved person id stays on the response when the activity read fails. */
export function panelFromRead(input: {
  participantKey: string;
  personId: number | null;
  referrioAgent: string | null;
  remote: RemoteResult | null;
  agentsDiffer: boolean;
}): PanelResponse {
  const link = input.personId ? { personId: input.personId, participantKey: input.participantKey } : null;
  if (!link) {
    return {
      officialScoring: false,
      access: 'allowed',
      link: null,
      activity: input.remote?.state === 'unavailable' ? { status: 'unavailable' } : { status: 'not_requested' },
    };
  }
  if (!input.remote) {
    return { officialScoring: false, access: 'allowed', link, activity: { status: 'not_requested' } };
  }
  if (input.remote.state === 'unavailable') {
    return { officialScoring: false, access: 'allowed', link, activity: { status: 'unavailable' } };
  }
  if (input.remote.state === 'not_found') {
    return { officialScoring: false, access: 'allowed', link, activity: { status: 'not_found' } };
  }
  if (input.remote.state === 'no_records') {
    return { officialScoring: false, access: 'allowed', link, activity: { status: 'no_activity', coverageDetail: input.remote.coverageDetail ?? null } };
  }
  return {
    officialScoring: false,
    access: 'allowed',
    link,
    activity: {
      status: 'ready',
      incomplete: input.remote.state === 'incomplete',
      latest: input.remote.latest,
      followUp: input.remote.followUp,
      fubAssignedUser: input.remote.fubAssignedUser,
      projectedClosings: input.remote.projectedClosings,
      referrioAgent: input.referrioAgent,
      agentsDiffer: input.agentsDiffer,
      freshnessNote: input.remote.freshness.note,
      coverageDetail: input.remote.coverageDetail ?? null,
    },
  };
}
