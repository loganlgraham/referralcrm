import { canViewFubDashboard, changeFubAccess } from '@/lib/server/fub-access';
import { User } from '@/models/user';
import { AccountOwner } from '@/models/account-owner';
import { FubDashboardAccess, IntelligenceAccess } from '@/models/intelligence-link';

jest.mock('@/models/user', () => ({ User: { collection: { findOne: jest.fn() } } }));
jest.mock('@/models/account-owner', () => ({ ACCOUNT_OWNER_KEY: 'owner', AccountOwner: { findOne: jest.fn() } }));
jest.mock('@/models/intelligence-link', () => ({ FubDashboardAccess: { findOne: jest.fn(), create: jest.fn() }, IntelligenceAccess: { findOne: jest.fn(), create: jest.fn() }, IntelligenceLink: {} }));
jest.mock('@/lib/intelligence/remote', () => ({ clearIntelligenceCache: jest.fn() }));

const OWNER = '6740aabbccddeeff00112233';
const ADMIN = '6740aabbccddeeff00112244';
const chain = (value: unknown) => ({ select: () => ({ lean: async () => value }) });
let role = 'admin';
let active = true;
let grant: { revokedAt: Date | null } | null = null;
beforeEach(() => {
  jest.clearAllMocks(); role = 'admin'; active = true; grant = null;
  process.env.REFERRIO_FUB_ACCOUNT_ID = '1846967076';
  (User.collection.findOne as jest.Mock).mockImplementation(async (query) => ({ _id: query._id, role: String(query._id) === OWNER ? 'admin' : role, active }));
  (AccountOwner.findOne as jest.Mock).mockImplementation(() => chain({ ownerUserId: OWNER }));
  (FubDashboardAccess.findOne as jest.Mock).mockImplementation(() => chain(grant));
  (IntelligenceAccess.findOne as jest.Mock).mockImplementation(() => chain({ revokedAt: null }));
});
test('owner is allowed; referral-only grants do not allow the dashboard', async () => {
  expect(await canViewFubDashboard(OWNER)).toBe(true);
  expect(await canViewFubDashboard(ADMIN)).toBe(false);
  expect(IntelligenceAccess.findOne).not.toHaveBeenCalled();
});
test('each read observes revocation, disabled accounts and stored role changes', async () => {
  grant = { revokedAt: null };
  expect(await canViewFubDashboard(ADMIN)).toBe(true);
  grant = { revokedAt: new Date() };
  expect(await canViewFubDashboard(ADMIN)).toBe(false);
  grant = { revokedAt: null }; active = false;
  expect(await canViewFubDashboard(ADMIN)).toBe(false);
  active = true; role = 'agent';
  expect(await canViewFubDashboard(ADMIN)).toBe(false);
});
test('only the owner can create a separate dashboard grant', async () => {
  const input = { actorUserId: ADMIN, targetUserId: ADMIN, organization: 'AHA' as const, access: true, at: new Date().toISOString(), scope: 'dashboard' as const };
  expect((await changeFubAccess(input)).ok).toBe(false);
  expect(FubDashboardAccess.create).not.toHaveBeenCalled();
  expect((await changeFubAccess({ ...input, actorUserId: OWNER })).ok).toBe(true);
  expect(FubDashboardAccess.create).toHaveBeenCalledTimes(1);
  expect(IntelligenceAccess.create).not.toHaveBeenCalled();
});

test('missing connection settings do not hide the dashboard from authorized users', async () => {
  delete process.env.REFERRIO_FUB_ACCOUNT_ID;
  expect(await canViewFubDashboard(OWNER)).toBe(true);
  expect(await canViewFubDashboard(ADMIN)).toBe(false);
  grant = { revokedAt: null };
  expect(await canViewFubDashboard(ADMIN)).toBe(true);
});
