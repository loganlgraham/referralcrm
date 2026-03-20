import { updateStatusSchema } from '@/utils/validators';

describe('updateStatusSchema', () => {
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
