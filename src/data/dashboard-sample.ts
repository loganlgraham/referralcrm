export interface SampleKPIData {
  requests: number;
  closings: number;
  conversion: number;
  expectedRevenueCents: number;
  receivedRevenueCents: number;
  avgTimeToFirstContactHours: number | null;
  avgDaysToContract: number | null;
  avgDaysToClose: number | null;
}

export const SAMPLE_KPI_DATA: SampleKPIData = {
  requests: 128,
  closings: 42,
  conversion: 32.8,
  expectedRevenueCents: 48200000,
  receivedRevenueCents: 36150000,
  avgTimeToFirstContactHours: 5.4,
  avgDaysToContract: 18.6,
  avgDaysToClose: 41.2
};

export interface SampleLeaderboardEntry {
  name: string;
  totalReferrals: number;
  closings: number;
  expectedRevenueCents: number;
}

export interface SampleLeaderboards {
  mc: SampleLeaderboardEntry[];
  agents: SampleLeaderboardEntry[];
  markets: SampleLeaderboardEntry[];
}

export const SAMPLE_LEADERBOARDS: SampleLeaderboards = {
  mc: [
    { name: 'Summit Home Loans', totalReferrals: 54, closings: 21, expectedRevenueCents: 12600000 },
    { name: 'Evergreen Mortgage', totalReferrals: 41, closings: 15, expectedRevenueCents: 9800000 },
    { name: 'Anchor Lending', totalReferrals: 33, closings: 11, expectedRevenueCents: 7200000 },
    { name: 'Liberty Funding', totalReferrals: 29, closings: 9, expectedRevenueCents: 6100000 },
    { name: 'Beacon Financial', totalReferrals: 24, closings: 8, expectedRevenueCents: 5400000 }
  ],
  agents: [
    { name: 'Avery Chen', totalReferrals: 26, closings: 12, expectedRevenueCents: 7100000 },
    { name: 'Jordan Patel', totalReferrals: 22, closings: 10, expectedRevenueCents: 6400000 },
    { name: 'Brooke Martinez', totalReferrals: 19, closings: 8, expectedRevenueCents: 5100000 },
    { name: 'Elias Robinson', totalReferrals: 17, closings: 7, expectedRevenueCents: 4600000 },
    { name: 'Morgan Lee', totalReferrals: 15, closings: 6, expectedRevenueCents: 3800000 }
  ],
  markets: [
    { name: 'Austin, TX', totalReferrals: 36, closings: 14, expectedRevenueCents: 10200000 },
    { name: 'Denver, CO', totalReferrals: 31, closings: 11, expectedRevenueCents: 8700000 },
    { name: 'Raleigh, NC', totalReferrals: 27, closings: 9, expectedRevenueCents: 6900000 },
    { name: 'Tampa, FL', totalReferrals: 24, closings: 8, expectedRevenueCents: 6100000 },
    { name: 'Boise, ID', totalReferrals: 21, closings: 7, expectedRevenueCents: 5400000 }
  ]
};

