const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/** Read an agent id from a raw ObjectId, a hex string, or a populated agent. */
export function referralAgentSlotId(slot: unknown): string | null {
  if (slot == null) return null;
  if (typeof slot === 'string') {
    return OBJECT_ID_PATTERN.test(slot) ? slot : null;
  }
  if (typeof slot !== 'object') return null;

  // ObjectIds stringify to the hex id and also expose a self-referential `_id`.
  if (typeof slot.toString === 'function') {
    const value = slot.toString();
    if (OBJECT_ID_PATTERN.test(value)) return value;
  }

  if ('_id' in slot && slot._id != null && slot._id !== slot) {
    return referralAgentSlotId(slot._id);
  }

  return null;
}
