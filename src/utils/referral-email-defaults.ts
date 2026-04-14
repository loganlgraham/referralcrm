interface EmailMcDefaultInputs {
  hasAnyPayments: boolean;
  hasAnyUsedAfcTrue: boolean;
}

export const shouldDefaultEmailMcForAgentNotes = ({
  hasAnyPayments,
  hasAnyUsedAfcTrue,
}: EmailMcDefaultInputs): boolean => {
  if (!hasAnyPayments) {
    return true;
  }

  return hasAnyUsedAfcTrue;
};
