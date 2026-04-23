import { describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(() => Promise.resolve())
}));

jest.mock('@/lib/auth', () => ({
  getCurrentSession: jest.fn(() => Promise.resolve(null))
}));

describe('GET /api/dashboard', () => {
  it('returns 401 when unauthenticated and no cron bearer', async () => {
    const { GET } = await import('@/app/api/dashboard/route');
    const req = new NextRequest('http://localhost/api/dashboard');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
