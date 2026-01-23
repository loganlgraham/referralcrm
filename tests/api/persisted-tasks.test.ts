import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Types } from 'mongoose';
import { connectMongo } from '@/lib/mongoose';
import { FollowUpTask } from '@/models/follow-up-task';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { syncReferralTasks, syncAgentOnboardingTasks } from '@/lib/server/task-sync';

/**
 * Tests for the new persisted task system.
 *
 * These tests verify that:
 * 1. Tasks are stored as first-class documents
 * 2. Completion persists correctly
 * 3. Sync functions work correctly and don't overwrite existing tasks
 * 4. Duplicate tasks are prevented
 */
describe('Persisted Tasks - New Task System', () => {
  // Test data IDs
  const testReferralId = new Types.ObjectId();
  const testAgentId = new Types.ObjectId();

  beforeAll(async () => {
    await connectMongo();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await FollowUpTask.deleteMany({
      $or: [{ referralId: testReferralId }, { agentId: testAgentId }],
    });
  });

  afterAll(async () => {
    // Clean up all test data
    await FollowUpTask.deleteMany({
      $or: [{ referralId: testReferralId }, { agentId: testAgentId }],
    });
  });

  describe('Task CRUD Operations', () => {
    it('should create a manual task and persist it', async () => {
      const task = await FollowUpTask.create({
        referralId: testReferralId,
        agentId: null,
        scope: 'referral',
        type: 'Task',
        title: 'Test Manual Task',
        message: 'This is a test manual task',
        category: 'ops',
        dueAt: new Date(),
        status: 'open',
        completedAt: null,
        completedByUserId: null,
        source: 'manual',
        ruleId: null,
        statusWhenCreated: 'New Lead',
      });

      expect(task._id).toBeDefined();
      expect(task.title).toBe('Test Manual Task');
      expect(task.source).toBe('manual');
      expect(task.status).toBe('open');

      // Verify it persists by fetching it again
      const fetchedTask = await FollowUpTask.findById(task._id);
      expect(fetchedTask).not.toBeNull();
      expect(fetchedTask?.title).toBe('Test Manual Task');
    });

    it('should toggle task completion and persist the change', async () => {
      // Create a task
      const task = await FollowUpTask.create({
        referralId: testReferralId,
        agentId: null,
        scope: 'referral',
        type: 'Call',
        title: 'Test Toggle Task',
        message: 'Test toggle functionality',
        category: 'communication',
        dueAt: new Date(),
        status: 'open',
        completedAt: null,
        completedByUserId: null,
        source: 'manual',
        ruleId: null,
        statusWhenCreated: null,
      });

      expect(task.status).toBe('open');

      // Toggle to completed
      const completedAt = new Date();
      await FollowUpTask.findByIdAndUpdate(task._id, {
        $set: {
          status: 'completed',
          completedAt,
        },
      });

      // Verify completion persists (simulates page refresh)
      const completedTask = await FollowUpTask.findById(task._id);
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.completedAt).toBeDefined();

      // Toggle back to open
      await FollowUpTask.findByIdAndUpdate(task._id, {
        $set: {
          status: 'open',
          completedAt: null,
        },
      });

      // Verify open state persists
      const openTask = await FollowUpTask.findById(task._id);
      expect(openTask?.status).toBe('open');
      expect(openTask?.completedAt).toBeNull();
    });

    it('should delete manual tasks but not static tasks', async () => {
      // Create a manual task
      const manualTask = await FollowUpTask.create({
        referralId: testReferralId,
        agentId: null,
        scope: 'referral',
        type: 'Task',
        title: 'Manual Task to Delete',
        message: 'This should be deletable',
        category: 'ops',
        dueAt: new Date(),
        status: 'open',
        completedAt: null,
        completedByUserId: null,
        source: 'manual',
        ruleId: null,
        statusWhenCreated: null,
      });

      // Create a static task
      const staticTask = await FollowUpTask.create({
        referralId: testReferralId,
        agentId: null,
        scope: 'referral',
        type: 'Task',
        title: 'Static Task',
        message: 'This should not be deleted by the API',
        category: 'ops',
        dueAt: new Date(),
        status: 'open',
        completedAt: null,
        completedByUserId: null,
        source: 'static',
        ruleId: 'test-rule-id',
        statusWhenCreated: 'New Lead',
      });

      // Delete the manual task
      await FollowUpTask.findByIdAndDelete(manualTask._id);

      // Verify manual task is gone
      const deletedManual = await FollowUpTask.findById(manualTask._id);
      expect(deletedManual).toBeNull();

      // Verify static task still exists
      const existingStatic = await FollowUpTask.findById(staticTask._id);
      expect(existingStatic).not.toBeNull();
    });
  });

  describe('Sync Functions', () => {
    it('should create tasks during sync without overwriting existing ones', async () => {
      // Create a referral for testing
      const referral = await Referral.create({
        borrower: {
          name: 'Test Borrower',
          email: `test-${Date.now()}@example.com`,
          phone: '555-1234',
        },
        status: 'Paired',
        ahaBucket: 'AHA_OOS',
        timeline: '6-12_months',
        lookingInZip: '12345',
        origin: 'admin',
      });

      try {
        // First sync - should create tasks
        const result1 = await syncReferralTasks(referral._id);
        expect(result1.created).toBeGreaterThan(0);
        expect(result1.errors).toHaveLength(0);

        const tasksAfterFirstSync = await FollowUpTask.find({ referralId: referral._id });
        const initialCount = tasksAfterFirstSync.length;
        expect(initialCount).toBeGreaterThan(0);

        // Complete one task
        const taskToComplete = tasksAfterFirstSync[0];
        await FollowUpTask.findByIdAndUpdate(taskToComplete._id, {
          $set: {
            status: 'completed',
            completedAt: new Date(),
          },
        });

        // Second sync - should NOT reset the completed task
        const result2 = await syncReferralTasks(referral._id);
        expect(result2.skipped).toBe(initialCount); // All existing tasks should be skipped
        expect(result2.created).toBe(0); // No new tasks created

        // Verify the task is still completed
        const completedTask = await FollowUpTask.findById(taskToComplete._id);
        expect(completedTask?.status).toBe('completed');
        expect(completedTask?.completedAt).toBeDefined();
      } finally {
        // Clean up
        await Referral.findByIdAndDelete(referral._id);
        await FollowUpTask.deleteMany({ referralId: referral._id });
      }
    });

    it('should prevent duplicate static tasks via unique index', async () => {
      // Create a static task
      await FollowUpTask.create({
        referralId: testReferralId,
        agentId: null,
        scope: 'referral',
        type: 'Task',
        title: 'Unique Static Task',
        message: 'First instance',
        category: 'ops',
        dueAt: new Date(),
        status: 'open',
        completedAt: null,
        completedByUserId: null,
        source: 'static',
        ruleId: 'unique-test-rule',
        statusWhenCreated: 'New Lead',
      });

      // Try to create a duplicate - should fail or be upserted
      try {
        await FollowUpTask.create({
          referralId: testReferralId,
          agentId: null,
          scope: 'referral',
          type: 'Task',
          title: 'Unique Static Task - Duplicate',
          message: 'This should not create a new document',
          category: 'ops',
          dueAt: new Date(),
          status: 'open',
          completedAt: null,
          completedByUserId: null,
          source: 'static',
          ruleId: 'unique-test-rule', // Same ruleId
          statusWhenCreated: 'New Lead',
        });
        // If it succeeds, it means the unique index didn't prevent it
        // This is expected if using partial filter expressions
      } catch (error: any) {
        // Duplicate key error is expected
        expect(error.code).toBe(11000);
      }

      // Verify only one task exists with this ruleId
      const tasks = await FollowUpTask.find({
        referralId: testReferralId,
        ruleId: 'unique-test-rule',
      });
      expect(tasks.length).toBe(1);
    });
  });

  describe('Agent Onboarding Tasks', () => {
    it('should create onboarding tasks for a new agent', async () => {
      // Create an agent for testing
      const agent = await Agent.create({
        name: 'Test Agent',
        email: `test-agent-${Date.now()}@example.com`,
        phone: '555-5678',
        ahaDesignation: 'AHA_OOS',
        active: true,
      });

      try {
        // Sync onboarding tasks
        const result = await syncAgentOnboardingTasks(agent._id);
        expect(result.created).toBeGreaterThan(0);
        expect(result.errors).toHaveLength(0);

        // Verify tasks were created
        const tasks = await FollowUpTask.find({ agentId: agent._id });
        expect(tasks.length).toBeGreaterThan(0);

        // Verify all tasks have scope='agent' and source='static'
        for (const task of tasks) {
          expect(task.scope).toBe('agent');
          expect(task.source).toBe('static');
          expect(task.ruleId).toMatch(/^agent-onboarding::/);
        }
      } finally {
        // Clean up
        await Agent.findByIdAndDelete(agent._id);
        await FollowUpTask.deleteMany({ agentId: agent._id });
      }
    });
  });

  describe('Query Operations', () => {
    it('should query tasks by referralId and status', async () => {
      // Create test tasks
      await FollowUpTask.create([
        {
          referralId: testReferralId,
          agentId: null,
          scope: 'referral',
          type: 'Task',
          title: 'Open Task 1',
          message: 'Open task',
          category: 'ops',
          dueAt: new Date(),
          status: 'open',
          completedAt: null,
          completedByUserId: null,
          source: 'manual',
          ruleId: null,
          statusWhenCreated: null,
        },
        {
          referralId: testReferralId,
          agentId: null,
          scope: 'referral',
          type: 'Task',
          title: 'Completed Task 1',
          message: 'Completed task',
          category: 'ops',
          dueAt: new Date(),
          status: 'completed',
          completedAt: new Date(),
          completedByUserId: null,
          source: 'manual',
          ruleId: null,
          statusWhenCreated: null,
        },
        {
          referralId: testReferralId,
          agentId: null,
          scope: 'referral',
          type: 'Call',
          title: 'Open Task 2',
          message: 'Another open task',
          category: 'communication',
          dueAt: new Date(),
          status: 'open',
          completedAt: null,
          completedByUserId: null,
          source: 'manual',
          ruleId: null,
          statusWhenCreated: null,
        },
      ]);

      // Query all tasks for the referral
      const allTasks = await FollowUpTask.find({ referralId: testReferralId });
      expect(allTasks.length).toBe(3);

      // Query only open tasks
      const openTasks = await FollowUpTask.find({
        referralId: testReferralId,
        status: 'open',
      });
      expect(openTasks.length).toBe(2);

      // Query only completed tasks
      const completedTasks = await FollowUpTask.find({
        referralId: testReferralId,
        status: 'completed',
      });
      expect(completedTasks.length).toBe(1);
    });

    it('should sort tasks by dueAt', async () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Create tasks with different due dates
      await FollowUpTask.create([
        {
          referralId: testReferralId,
          agentId: null,
          scope: 'referral',
          type: 'Task',
          title: 'Tomorrow Task',
          message: 'Due tomorrow',
          category: 'ops',
          dueAt: tomorrow,
          status: 'open',
          completedAt: null,
          completedByUserId: null,
          source: 'manual',
          ruleId: null,
          statusWhenCreated: null,
        },
        {
          referralId: testReferralId,
          agentId: null,
          scope: 'referral',
          type: 'Task',
          title: 'Yesterday Task',
          message: 'Due yesterday (overdue)',
          category: 'ops',
          dueAt: yesterday,
          status: 'open',
          completedAt: null,
          completedByUserId: null,
          source: 'manual',
          ruleId: null,
          statusWhenCreated: null,
        },
        {
          referralId: testReferralId,
          agentId: null,
          scope: 'referral',
          type: 'Task',
          title: 'Today Task',
          message: 'Due today',
          category: 'ops',
          dueAt: now,
          status: 'open',
          completedAt: null,
          completedByUserId: null,
          source: 'manual',
          ruleId: null,
          statusWhenCreated: null,
        },
      ]);

      // Query with sort by dueAt ascending
      const sortedTasks = await FollowUpTask.find({ referralId: testReferralId }).sort({
        dueAt: 1,
      });

      expect(sortedTasks[0].title).toBe('Yesterday Task');
      expect(sortedTasks[1].title).toBe('Today Task');
      expect(sortedTasks[2].title).toBe('Tomorrow Task');
    });
  });
});
