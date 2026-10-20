interface EmailMcDefaultInputs {
  viewerRole: string;
  hasMcEmail: boolean;
  hasAnyPayments: boolean;
  hasAnyUsedAfcTrue: boolean;
}

/**
 * Email MC defaults ON only for the agent role (and only when an MC email exists),
 * following buy-side AFC usage: ON with no buy-side deal yet, or when any buy-side
 * deal used AFC; OFF when every buy-side deal used an outside lender.
 * Admin/manager/MC/viewer always default OFF.
 */
export const shouldDefaultEmailMcForAgentNotes = ({
  viewerRole,
  hasMcEmail,
  hasAnyPayments,
  hasAnyUsedAfcTrue,
}: EmailMcDefaultInputs): boolean => {
  if (viewerRole !== 'agent' || !hasMcEmail) {
    return false;
  }

  if (!hasAnyPayments) {
    return true;
  }

  return hasAnyUsedAfcTrue;
};
