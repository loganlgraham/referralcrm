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

  it('rejects terminateDeal with statuses other than Active Lead or Lost', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Terminated',
      terminateDeal: true,
      terminatedReason: 'inspection',
    });
    expect(result.success).toBe(false);
  });

  it('accepts terminateDeal with Active Lead and terminatedReason', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Active Lead',
      terminateDeal: true,
      terminatedReason: 'financing',
    });
    expect(result.success).toBe(true);
  });

  it('accepts terminateDeal with Lost and terminatedReason', () => {
    const result = updateStatusSchema.safeParse({
      status: 'Lost',
      terminateDeal: true,
      terminatedReason: 'changed_mind',
    });
    expect(result.success).toBe(true);
  });
});
