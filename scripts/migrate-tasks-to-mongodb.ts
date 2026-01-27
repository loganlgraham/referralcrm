/**
 * Migration Script: Convert existing task state to MongoDB-backed system
 * 
 * This script:
 * 1. Converts FollowUpTaskState.manualTasks to FollowUpTask documents
 * 2. Converts Referral.manualTasks to FollowUpTask documents
 * 3. Converts completions to update matching FollowUpTask.status
 * 4. Runs reconcileSystemTasks for all referrals to ensure system tasks exist
 */

import { connectMongo } from '../src/lib/mongoose';
import { FollowUpTask } from '../src/models/follow-up-task';
import { FollowUpTaskState } from '../src/models/follow-up-task-state';
import { Referral } from '../src/models/referral';
import { reconcileSystemTasks } from '../src/lib/server/task-sync';
import { Types } from 'mongoose';

async function migrateTasks() {
  await connectMongo();
  console.log('Starting task migration...\n');

  let migratedManualTasks = 0;
  let migratedCompletions = 0;
  let reconciledReferrals = 0;
  let errors: string[] = [];

  // 1. Migrate FollowUpTaskState.manualTasks
  console.log('Step 1: Migrating FollowUpTaskState.manualTasks...');
  const taskStates = await FollowUpTaskState.find({}).lean();
  console.log(`Found ${taskStates.length} FollowUpTaskState documents`);

  for (const state of taskStates) {
    const referralId = state.referralId;
    if (!referralId || !Types.ObjectId.isValid(referralId)) {
      continue;
    }

    const refId = new Types.ObjectId(referralId);

    // Migrate manual tasks
    if (Array.isArray(state.manualTasks) && state.manualTasks.length > 0) {
      for (const manualTask of state.manualTasks) {
        try {
          // Check if task already exists
          const existing = await FollowUpTask.findOne({
            referralId: refId,
            source: 'manual',
            title: manualTask.title,
            message: manualTask.message,
          });

          if (!existing) {
            await FollowUpTask.create({
              referralId: refId,
              agentId: null,
              scope: 'referral',
              type: 'Task', // Default type for manual tasks
              title: manualTask.title,
              message: manualTask.message,
              category: manualTask.category as any,
              dueAt: manualTask.dueAt ? new Date(manualTask.dueAt) : new Date(),
              status: 'open',
              completedAt: null,
              completedByUserId: null,
              source: 'manual',
              ruleId: null,
              statusWhenCreated: null,
              anchor: null,
            });
            migratedManualTasks++;
          }
        } catch (error) {
          const errorMsg = `Failed to migrate manual task for referral ${referralId}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }
    }

    // Migrate completions
    if (Array.isArray(state.completions) && state.completions.length > 0) {
      for (const completion of state.completions) {
        if (!completion.taskId || !completion.completed) {
          continue;
        }

        try {
          // Try to find task by ruleId or manual task match
          const taskIdParts = completion.taskId.split('::');
          let task = null;

          if (completion.taskId.includes('::manual::')) {
            // Manual task - try to match by title/message
            const manualTaskId = taskIdParts[taskIdParts.length - 1];
            // We can't reliably match manual tasks by ID, so skip completion migration for manual tasks
            // They will be marked complete when the user toggles them
            continue;
          } else {
            // System task - match by ruleId
            const ruleId = taskIdParts[taskIdParts.length - 1];
            task = await FollowUpTask.findOne({
              referralId: refId,
              ruleId: ruleId,
              source: 'static',
            });
          }

          if (task && completion.completed) {
            await FollowUpTask.updateOne(
              { _id: task._id },
              {
                $set: {
                  status: 'completed',
                  completedAt: completion.completedAt ? new Date(completion.completedAt) : new Date(),
                },
              }
            );
            migratedCompletions++;
          }
        } catch (error) {
          const errorMsg = `Failed to migrate completion for task ${completion.taskId}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }
    }
  }

  console.log(`Migrated ${migratedManualTasks} manual tasks from FollowUpTaskState`);
  console.log(`Migrated ${migratedCompletions} completions from FollowUpTaskState\n`);

  // 2. Migrate Referral.manualTasks
  console.log('Step 2: Migrating Referral.manualTasks...');
  const referralsWithManualTasks = await Referral.find({
    manualTasks: { $exists: true, $ne: [] },
  }).select('_id manualTasks').lean();

  console.log(`Found ${referralsWithManualTasks.length} referrals with embedded manualTasks`);

  for (const referral of referralsWithManualTasks) {
    if (!Array.isArray(referral.manualTasks)) {
      continue;
    }

    for (const manualTask of referral.manualTasks) {
      try {
        // Check if task already exists
        const existing = await FollowUpTask.findOne({
          referralId: referral._id,
          source: 'manual',
          title: manualTask.title,
          message: manualTask.message,
        });

        if (!existing) {
          await FollowUpTask.create({
            referralId: referral._id,
            agentId: null,
            scope: 'referral',
            type: 'Task',
            title: manualTask.title,
            message: manualTask.message,
            category: manualTask.category as any,
            dueAt: manualTask.dueAt ? new Date(manualTask.dueAt) : new Date(),
            status: 'open',
            completedAt: null,
            completedByUserId: null,
            source: 'manual',
            ruleId: null,
            statusWhenCreated: null,
            anchor: null,
          });
          migratedManualTasks++;
        }
      } catch (error) {
        const errorMsg = `Failed to migrate manual task from referral ${referral._id}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
  }

  console.log(`Migrated ${migratedManualTasks} total manual tasks (including from Referral.manualTasks)\n`);

  // 3. Reconcile system tasks for all referrals
  console.log('Step 3: Reconciling system tasks for all referrals...');
  const allReferrals = await Referral.find({ deletedAt: null })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
  console.log(`Found ${allReferrals.length} active referrals`);

  let processed = 0;
  for (const referral of allReferrals) {
    try {
      const result = await reconcileSystemTasks(referral._id);
      reconciledReferrals++;
      if (result.created > 0 || result.archived > 0) {
        console.log(`Referral ${referral._id}: created ${result.created}, archived ${result.archived}`);
      }
      processed++;
      if (processed % 100 === 0) {
        console.log(`Processed ${processed}/${allReferrals.length} referrals...`);
      }
    } catch (error) {
      const errorMsg = `Failed to reconcile tasks for referral ${referral._id}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      console.error(errorMsg);
    }
  }

  console.log(`\nReconciled system tasks for ${reconciledReferrals} referrals\n`);

  // Summary
  console.log('=== Migration Summary ===');
  console.log(`Manual tasks migrated: ${migratedManualTasks}`);
  console.log(`Completions migrated: ${migratedCompletions}`);
  console.log(`Referrals reconciled: ${reconciledReferrals}`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.slice(0, 10).forEach((error) => console.error(`  - ${error}`));
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more errors`);
    }
  }

  console.log('\nMigration complete!');
  process.exit(0);
}

migrateTasks().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
