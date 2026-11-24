/**
 * @jest-environment node
 */

import { MockFubPerson, MockFubSendAttempt } from '@/models/mock-fub';

describe('mock FUB fixture models', () => {
  it('allows only one send attempt per fixture run and referral', () => {
    expect(MockFubSendAttempt.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ fixtureRunId: 1, referralId: 1 }, expect.objectContaining({ unique: true })],
      ]),
    );
  });

  it('keeps mock people isolated by fixture run and mock person id', () => {
    expect(MockFubPerson.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ fixtureRunId: 1, personId: 1 }, expect.objectContaining({ unique: true })],
      ]),
    );
  });
});
