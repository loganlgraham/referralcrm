import type { NextRequest } from 'next/server';

const adminDashboardRequests = new WeakSet<NextRequest>();

export function markDashboardRequestAsInternalAdmin(request: NextRequest): NextRequest {
  adminDashboardRequests.add(request);
  return request;
}

export function isDashboardInternalAdminRequest(request: NextRequest): boolean {
  return adminDashboardRequests.has(request);
}
