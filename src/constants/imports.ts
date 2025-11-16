export const IMPORT_ENTITY_CONFIG = {
  Referral: {
    description:
      'Borrower referrals handed off between mortgage consultants and AHA partner agents, including borrower contact info, source, geography, and lifecycle status.',
    fields: [
      'borrowerName',
      'borrowerEmail',
      'borrowerPhone',
      'source',
      'endorser',
      'clientType',
      'lookingInZip',
      'borrowerCurrentAddress',
      'stageOnTransfer',
      'loanFileNumber',
      'initialNotes',
      'status',
      'createdAt'
    ]
  },
  Agent: {
    description:
      'AHA agent roster entries describing the person that will receive the referral, their contact info, and coverage footprint.',
    fields: ['name', 'email', 'phone', 'statesLicensed', 'zipCoverage']
  },
  'Mortgage Consultant': {
    description:
      'AFC mortgage consultant (MC) roster entries with NMLS IDs, regions, and teams tied to inbound referrals.',
    fields: ['name', 'email', 'phone', 'nmlsId', 'team', 'region']
  },
  Deal: {
    description:
      'Referral deal / payment ledger rows describing payout expectations, received funds, termination reasons, and attribution metadata.',
    fields: [
      'referralId',
      'status',
      'expectedAmountCents',
      'receivedAmountCents',
      'invoiceDate',
      'paidDate',
      'terminatedReason',
      'agentOutcome',
      'usedAfc',
      'agentAttribution',
      'agentAttributionType',
      'notes'
    ]
  }
} as const;

export type ImportEntity = keyof typeof IMPORT_ENTITY_CONFIG;

export const IMPORT_ENTITY_NAMES = Object.keys(IMPORT_ENTITY_CONFIG) as ImportEntity[];

export const isImportEntity = (value: string): value is ImportEntity =>
  Object.prototype.hasOwnProperty.call(IMPORT_ENTITY_CONFIG, value);
