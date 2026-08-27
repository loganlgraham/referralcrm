import { updateStatusSchema } from '@/utils/validators';

describe('updateStatusSchema', () => {
  it('accepts optional source on status updates', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Closed',
      source: 'referral_table',
    });
    expect(result.success).toBe(true);
  });

  it('requires terminatedReason when status is Terminated', () => {
    const result = updateStatusSchema.safeParse({ status: 'Terminated' });
    expect(result.success).toBe(false);
  });

  it('accepts terminatedReason when status is Terminated', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Terminated',
      terminatedReason: 'inspection',
    });
    expect(result.success).toBe(true);
  });

  it('requires terminatedReason when terminateDeal is true', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Active Lead',
      terminateDeal: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects terminateDeal with statuses other than Active Lead, In Communication, or Lost', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Terminated',
      terminateDeal: true,
      terminatedReason: 'inspection',
    });
    expect(result.success).toBe(false);
  });

  it('accepts terminateDeal with In Communication and terminatedReason', () => {
    const result = updateStatusSchema.safeParse({
      status: 'In Communication',
      terminateDeal: true,
      terminatedReason: 'financing',
    });
    expect(result.success).toBe(true);
  });

  it('accepts terminateDeal with Active Lead and terminatedReason', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Active Lead',
      terminateDeal: true,
      terminatedReason: 'financing',
    });
    expect(result.success).toBe(true);
  });

  it('accepts terminateDeal with Lost, terminatedReason, and lostReason', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Lost',
      terminateDeal: true,
      terminatedReason: 'changed_mind',
      lostReason: 'no_longer_buying',
    });
    expect(result.success).toBe(true);
  });

  it('requires lostReason when status is Lost', () => {
    const result = updateStatusSchema.safeParse({ status: 'Lost' });
    expect(result.success).toBe(false);
  });

  it('accepts lostReason when status is Lost', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Lost',
      lostReason: 'already_had_agent',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a lostReason outside the taxonomy', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Lost',
      lostReason: 'made_up_reason',
    });
    expect(result.success).toBe(false);
  });

  it('does not require lostReason for other statuses', () => {
    const result = updateStatusSchema.safeParse({ status: 'Paired' });
    expect(result.success).toBe(true);
  });
});
