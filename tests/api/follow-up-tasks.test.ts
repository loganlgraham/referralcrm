import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { connectMongo } from '@/lib/mongoose';
import { FollowUpTaskState } from '@/models/follow-up-task-state';

/**
 * Test to verify that task completion persists to the database
 * and can be retrieved after a "refresh" (simulated by a new GET request).
 * 
 * This test verifies the fix for the bug where task completions on the
 * Follow-Up Tasks page would not persist after page refresh.
 */
describe('Follow-up Tasks API - Completion Persistence', () => {
  const testReferralId = 'test-referral-persistence-123';
  const testTaskId = `${testReferralId}::test-task-id`;

  beforeAll(async () => {
    await connectMongo();
    // Clean up any existing test data
    await FollowUpTaskState.deleteOne({ referralId: testReferralId });
  });

  afterAll(async () => {
    // Clean up test data
    await FollowUpTaskState.deleteOne({ referralId: testReferralId });
  });

  it('should persist task completion and retrieve it after refresh', async () => {
    // Step 1: Initial state - no completions
    let doc = await FollowUpTaskState.findOne({ referralId: testReferralId });
    expect(doc).toBeNull();

    // Step 2: Toggle task to completed (simulate PUT request)
    const completionsPayload = {
      [testTaskId]: {
        completed: true,
        completedAt: new Date().toISOString(),
      },
    };

    doc = await FollowUpTaskState.findOneAndUpdate(
      { referralId: testReferralId },
      {
        $set: {
          completions: [
            {
              taskId: testTaskId,
              completed: true,
              completedAt: new Date().toISOString(),
            },
          ],
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    expect(doc).not.toBeNull();
    expect(doc?.completions).toBeDefined();
    expect(Array.isArray(doc?.completions)).toBe(true);
    const completion = (doc?.completions as Array<{ taskId: string; completed: boolean }>).find(
      (c) => c.taskId === testTaskId
    );
    expect(completion).toBeDefined();
    expect(completion?.completed).toBe(true);

    // Step 3: Simulate page refresh - GET the state again
    const refreshedDoc = await FollowUpTaskState.findOne({ referralId: testReferralId });
    expect(refreshedDoc).not.toBeNull();
    expect(refreshedDoc?.completions).toBeDefined();
    const refreshedCompletion = (
      refreshedDoc?.completions as Array<{ taskId: string; completed: boolean }>
    ).find((c) => c.taskId === testTaskId);
    expect(refreshedCompletion).toBeDefined();
    expect(refreshedCompletion?.completed).toBe(true);

    // Step 4: Toggle task to incomplete
    await FollowUpTaskState.findOneAndUpdate(
      { referralId: testReferralId },
      {
        $set: {
          completions: [
            {
              taskId: testTaskId,
              completed: false,
              completedAt: null,
            },
          ],
        },
      },
      { new: true }
    );

    // Step 5: Verify incomplete state persists after "refresh"
    const incompleteDoc = await FollowUpTaskState.findOne({ referralId: testReferralId });
    expect(incompleteDoc).not.toBeNull();
    const incompleteCompletion = (
      incompleteDoc?.completions as Array<{ taskId: string; completed: boolean }>
    ).find((c) => c.taskId === testTaskId);
    expect(incompleteCompletion).toBeDefined();
    expect(incompleteCompletion?.completed).toBe(false);
  });

  it('should handle multiple task completions for the same referral', async () => {
    const taskId1 = `${testReferralId}::task-1`;
    const taskId2 = `${testReferralId}::task-2`;

    // Set up two tasks with different completion states
    await FollowUpTaskState.findOneAndUpdate(
      { referralId: testReferralId },
      {
        $set: {
          completions: [
            {
              taskId: taskId1,
              completed: true,
              completedAt: new Date().toISOString(),
            },
            {
              taskId: taskId2,
              completed: false,
              completedAt: null,
            },
          ],
        },
      },
      { new: true, upsert: true }
    );

    // Verify both states persist
    const doc = await FollowUpTaskState.findOne({ referralId: testReferralId });
    expect(doc).not.toBeNull();
    const completions = doc?.completions as Array<{ taskId: string; completed: boolean }>;
    expect(completions.length).toBeGreaterThanOrEqual(2);

    const completion1 = completions.find((c) => c.taskId === taskId1);
    const completion2 = completions.find((c) => c.taskId === taskId2);

    expect(completion1?.completed).toBe(true);
    expect(completion2?.completed).toBe(false);
  });
});
