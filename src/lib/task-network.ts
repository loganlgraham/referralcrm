export type TaskNetworkParam = 'all' | 'aha' | 'oos' | 'agit';

export type TaskNetworkDesignation = 'AHA' | 'AHA_OOS' | 'AGIT';

export function parseTaskNetwork(value: string | null | undefined): TaskNetworkParam {
  if (value === 'aha' || value === 'oos' || value === 'agit') return value;
  return 'all';
}

export function taskNetworkDesignation(network: TaskNetworkParam): TaskNetworkDesignation | null {
  switch (network) {
    case 'all':
      return null;
    case 'aha':
      return 'AHA';
    case 'oos':
      return 'AHA_OOS';
    case 'agit':
      return 'AGIT';
    default: {
      const exhaustive: never = network;
      return exhaustive;
    }
  }
}

export function taskNetworkLabel(network: TaskNetworkParam): string {
  switch (network) {
    case 'all':
      return 'All';
    case 'aha':
      return 'AHA';
    case 'oos':
      return 'OOS';
    case 'agit':
      return 'AGIT';
    default: {
      const exhaustive: never = network;
      return exhaustive;
    }
  }
}

/** Full network name for sentences. Chips keep the short label. */
export function taskNetworkSentenceLabel(network: TaskNetworkParam): string {
  switch (network) {
    case 'all':
      return 'All';
    case 'aha':
      return 'AHA';
    case 'oos':
      return 'AHA OOS';
    case 'agit':
      return 'AGIT';
    default: {
      const exhaustive: never = network;
      return exhaustive;
    }
  }
}

/** All includes undesignated referrals. A specific network matches that designation only. */
export function referralMatchesTaskNetwork(
  designation: TaskNetworkDesignation | null,
  network: TaskNetworkParam
): boolean {
  if (network === 'all') return true;
  return designation === taskNetworkDesignation(network);
}
