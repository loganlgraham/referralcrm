const FROM_TO_PATTERN = /^status changed from\s+.+\s+to\s+(.+)$/i;
const TO_ONLY_PATTERN = /^status\s+(?:changed|moved|updated)\s+to\s+(.+)$/i;

/** Pulls the landing status out of a referral status activity line. */
export const parseStatusActivityLabel = (content: string): string | null => {
  const trimmed = content.trim();
  const fromTo = FROM_TO_PATTERN.exec(trimmed);
  if (fromTo?.[1]) {
    const label = fromTo[1].trim();
    return label.length > 0 ? label : null;
  }
  const toOnly = TO_ONLY_PATTERN.exec(trimmed);
  if (toOnly?.[1]) {
    const label = toOnly[1].trim();
    return label.length > 0 ? label : null;
  }
  return null;
};
