import { describe, expect, it, jest } from '@jest/globals';

import { POST } from '@/app/api/referrals/route';
import { connectMongo } from '@/lib/mongoose';

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getCurrentSession: jest.fn(() => Promise.resolve(null)),
}));

describe('Referrals API', () => {
  it('requires authentication for POST', async () => {
    const response = await POST(new Request('http://localhost/api/referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(401);
    expect(connectMongo).not.toHaveBeenCalled();
  });
});
