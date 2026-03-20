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
});
