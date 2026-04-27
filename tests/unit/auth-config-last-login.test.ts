import { Types } from 'mongoose';

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(async () => undefined),
}));

jest.mock('@/lib/mongodb-client', () => ({
  getClientPromise: jest.fn(async () => ({}))
}));

jest.mock('@/models/user', () => ({
  User: {
    updateOne: jest.fn(async () => ({ acknowledged: true })),
  },
}));

jest.mock('next-auth/providers/email', () => ({
  __esModule: true,
  default: jest.fn(() => ({ id: 'email' }))
}));

jest.mock('@next-auth/mongodb-adapter', () => ({
  MongoDBAdapter: jest.fn(() => ({ name: 'mock-adapter' }))
}));

const { connectMongo } = require('@/lib/mongoose') as {
  connectMongo: jest.Mock;
};
const { User } = require('@/models/user') as {
  User: { updateOne: jest.Mock };
};
const { authOptions, persistUserLastLoginAt } = require('@/lib/auth-config') as {
  authOptions: {
    events?: { signIn?: (args: unknown) => Promise<void> };
    callbacks?: { jwt?: (args: unknown) => Promise<unknown> };
  };
  persistUserLastLoginAt: (input: { id?: string | null; email?: string | null }) => Promise<void>;
};

describe('Auth config last login persistence', () => {
  const mockedConnectMongo = connectMongo;
  const mockedUpdateOne = User.updateOne;

  beforeEach(() => {
    mockedConnectMongo.mockClear();
    mockedUpdateOne.mockClear();
  });

  it('persists last login timestamp using user id', async () => {
    await persistUserLastLoginAt({ id: 'user-123', email: 'ignored@example.com' });

    expect(mockedConnectMongo).toHaveBeenCalledTimes(1);
    expect(mockedUpdateOne).toHaveBeenCalledWith(
      { _id: 'user-123' },
      { $set: { lastLoginAt: expect.any(Date) } }
    );
  });

  it('uses ObjectId when id is a valid ObjectId hex string', async () => {
    const validId = '507f1f77bcf86cd799439011';
    await persistUserLastLoginAt({ id: validId });

    expect(mockedUpdateOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId) },
      { $set: { lastLoginAt: expect.any(Date) } }
    );
    const arg = mockedUpdateOne.mock.calls[mockedUpdateOne.mock.calls.length - 1][0] as {
      _id: Types.ObjectId;
    };
    expect(arg._id.toString()).toBe(validId);
  });

  it('falls back to normalized email when id is missing', async () => {
    await persistUserLastLoginAt({ email: '  Agent@Example.com  ' });

    expect(mockedConnectMongo).toHaveBeenCalledTimes(1);
    expect(mockedUpdateOne).toHaveBeenCalledWith(
      { email: 'agent@example.com' },
      { $set: { lastLoginAt: expect.any(Date) } }
    );
  });

  it('no-ops when id and email are missing', async () => {
    await persistUserLastLoginAt({});

    expect(mockedConnectMongo).not.toHaveBeenCalled();
    expect(mockedUpdateOne).not.toHaveBeenCalled();
  });

  it('does not throw when sign-in event persistence fails', async () => {
    mockedUpdateOne.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      authOptions.events?.signIn?.({
        user: { id: 'user-123', email: 'agent@example.com' },
        account: null,
        profile: null,
        isNewUser: false
      } as never)
    ).resolves.toBeUndefined();
  });

  it('persists last login when jwt callback receives user', async () => {
    const jwt = authOptions.callbacks?.jwt;
    expect(jwt).toBeDefined();

    await jwt!(
      {
        token: {},
        user: {
          id: '507f1f77bcf86cd799439011',
          email: 'agent@example.com',
          role: 'agent'
        },
        account: null,
        profile: undefined,
        trigger: 'signIn'
      } as never
    );

    expect(mockedConnectMongo).toHaveBeenCalled();
    expect(mockedUpdateOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId) },
      { $set: { lastLoginAt: expect.any(Date) } }
    );
  });

  it('does not throw when jwt last-login persistence fails', async () => {
    mockedUpdateOne.mockRejectedValueOnce(new Error('write failed'));
    const jwt = authOptions.callbacks?.jwt;

    await expect(
      jwt!({
        token: {},
        user: {
          id: '507f1f77bcf86cd799439011',
          email: 'agent@example.com',
          role: 'agent'
        },
        account: null,
        profile: undefined,
        trigger: 'signIn'
      } as never)
    ).resolves.toEqual(expect.any(Object));
  });
});
