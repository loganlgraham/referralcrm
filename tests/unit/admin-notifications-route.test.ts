/** @jest-environment node */

import { NextRequest } from 'next/server';

import { GET } from '@/app/api/admin/notifications/route';
import { getCurrentSession } from '@/lib/auth';
import { getNotifications, getUnreadNotificationCount } from '@/lib/server/notifications';

jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn(async () => undefined) }));
jest.mock('@/lib/server/notifications', () => ({
  getUnreadNotificationCount: jest.fn(),
  getNotifications: jest.fn(),
}));

const mockSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockCount = getUnreadNotificationCount as jest.MockedFunction<typeof getUnreadNotificationCount>;
const mockList = getNotifications as jest.MockedFunction<typeof getNotifications>;

describe('admin notifications route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue({
      expires: '',
      user: { id: 'admin-id', role: 'admin', email: 'admin@example.com' },
    } as never);
    mockCount.mockResolvedValue(3);
    mockList.mockResolvedValue([{ _id: 'n1' }] as never);
  });

  it('returns only the unread count when count=1', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/notifications?count=1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 3 });
    expect(mockCount).toHaveBeenCalledWith('admin-id');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('returns count and list for the full payload', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/notifications'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      count: 3,
      notifications: [{ _id: 'n1' }],
    });
    expect(mockList).toHaveBeenCalledWith('admin-id', 50);
  });
});
