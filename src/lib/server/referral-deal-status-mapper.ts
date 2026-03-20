import { type DealStatus } from '@/constants/deals';
import { type ReferralStatus } from '@/constants/referrals';

export const mapReferralStatusToDealStatus = (
  status: ReferralStatus
): DealStatus | null => {
  switch (status) {
    case 'Under Contract':
      return 'under_contract';
    case 'Closed':
      return 'closed';
    case 'Terminated':
      return 'terminated';
    case 'New Lead':
    case 'Paired':
    case 'In Communication':
    case 'Active Lead':
    case 'Lost':
      return null;
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
};

export const mapDealStatusToReferralStatus = (
  status: DealStatus
): ReferralStatus => {
  switch (status) {
    case 'under_contract':
    case 'past_inspection':
    case 'past_appraisal':
    case 'clear_to_close':
      return 'Under Contract';
    case 'closed':
    case 'payment_sent':
    case 'paid':
      return 'Closed';
    case 'terminated':
      return 'Terminated';
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
};
