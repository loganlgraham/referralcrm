/**
 * Migration Script: Migrate from FollowUpTaskState to FollowUpTask collection
 *
 * This script:
 * 1. Creates FollowUpTask documents from existing manual tasks
 * 2. Preserves completion state from the old system
 * 3. Optionally syncs static tasks for all referrals
 *
 * Run: pnpm tsx scripts/migrate-to-follow-up-tasks.ts
 *
 * Options:
 *   --dry-run         Don't write to database, just log what would happen
 *   --sync-static     Also sync static tasks for all referrals (slower)
 *   --skip-manual     Skip migrating manual tasks
 *   --verbose         Log detailed information
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import { connectMongo } from '../src/lib/mongoose';
import { FollowUpTaskState, type FollowUpManualTask, type FollowUpTaskCompletion } from '../src/models/follow-up-task-state';
import { FollowUpTask } from '../src/models/follow-up-task';
import { Referral } from '../src/models/referral';
import { Agent } from '../src/models/agent';
import { syncReferralTasks, syncAgentOnboardingTasks } from '../src/lib/server/task-sync';

interface MigrationStats {
  manualTasksCreated: number;
  manualTasksSkipped: number;
  completionsPreserved: number;
  referralsSynced: number;
  agentsSynced: number;
  errors: string[];
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SYNC_STATIC = args.includes('--sync-static');
const SKIP_MANUAL = args.includes('--skip-manual');
const VERBOSE = args.includes('--verbose');

function log(message: string) {
  console.log(message);
}

function verbose(message: string) {
  if (VERBOSE) {
    console.log(`  ${message}`);
  }
}

async function migrateManualTasks(stats: MigrationStats) {
  log('\n=== Migrating Manual Tasks ===\n');

  const docs = await FollowUpTaskState.find({}).lean<
    Array<{
      _id: unknown;
      referralId?: string;
      manualTasks?: FollowUpManualTask[];
      completions?: FollowUpTaskCompletion[];
    }>
  >();

  log(`Found ${docs.length} FollowUpTaskState documents to process`);

  for (const doc of docs) {
    const referralId = typeof doc.referralId === 'string' ? doc.referralId : null;

    if (!referralId) {
      verbose(`Skipping document ${doc._id}: missing referralId`);
      continue;
    }

    // Validate referralId is a valid ObjectId
    if (!Types.ObjectId.isValid(referralId)) {
      verbose(`Skipping document ${doc._id}: invalid referralId format`);
      continue;
    }

    const manualTasks = Array.isArray(doc.manualTasks) ? doc.manualTasks : [];
    const completions = Array.isArray(doc.completions) ? doc.completions : [];

    if (manualTasks.length === 0) {
      verbose(`Referral ${referralId}: no manual tasks to migrate`);
      continue;
    }

    log(`Processing referral ${referralId}: ${manualTasks.length} manual tasks`);

    // Build completion map for quick lookup
    const completionMap = new Map<string, FollowUpTaskCompletion>();
    for (const completion of completions) {
      completionMap.set(completion.taskId, completion);
    }

    for (const manualTask of manualTasks) {
      // Check for completion using both formats
      const fullTaskId = `${referralId}::manual::${manualTask.id}`;
      const completion = completionMap.get(fullTaskId) || completionMap.get(manualTask.id);
      const isCompleted = completion?.completed ?? false;
      const completedAt = completion?.completedAt ? new Date(completion.completedAt) : null;

      verbose(`  Task "${manualTask.title}" (${manualTask.id}): completed=${isCompleted}`);

      if (DRY_RUN) {
        stats.manualTasksCreated++;
        if (isCompleted) {
          stats.completionsPreserved++;
        }
        continue;
      }

      try {
        // Check if task already exists (idempotent migration)
        const existingTask = await FollowUpTask.findOne({
          referralId: new Types.ObjectId(referralId),
          source: 'manual',
          title: manualTask.title,
          createdAt: { $gte: new Date(new Date(manualTask.createdAt).getTime() - 1000), $lte: new Date(new Date(manualTask.createdAt).getTime() + 1000) },
        });

        if (existingTask) {
          verbose(`  Task "${manualTask.title}" already exists, skipping`);
          stats.manualTasksSkipped++;
          continue;
        }

        // Map old category to new category
        const categoryMap: Record<string, 'ops' | 'communication' | 'pipeline' | 'finance'> = {
          assignment: 'ops',
          communication: 'communication',
          pipeline: 'pipeline',
          finance: 'finance',
          ops: 'ops',
        };

        const category = categoryMap[manualTask.category] || 'ops';

        // Create the task
        await FollowUpTask.create({
          referralId: new Types.ObjectId(referralId),
          agentId: null,
          scope: 'referral',
          type: 'Task',
          title: manualTask.title,
          message: manualTask.message,
          category,
          dueAt: manualTask.dueAt ? new Date(manualTask.dueAt) : new Date(),
          status: isCompleted ? 'completed' : 'open',
          completedAt: isCompleted ? completedAt : null,
          completedByUserId: null,
          source: 'manual',
          ruleId: null,
          statusWhenCreated: null,
        });

        stats.manualTasksCreated++;
        if (isCompleted) {
          stats.completionsPreserved++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        stats.errors.push(`Failed to migrate task "${manualTask.title}" for referral ${referralId}: ${errorMessage}`);
      }
    }
  }
}

async function syncStaticTasksForReferrals(stats: MigrationStats) {
  log('\n=== Syncing Static Tasks for Referrals ===\n');

  const referrals = await Referral.find({ deletedAt: null })
    .select('_id status ahaBucket timeline')
    .lean<Array<{ _id: Types.ObjectId; status: string; ahaBucket?: string; timeline?: string }>>();

  log(`Found ${referrals.length} referrals to sync`);

  for (const referral of referrals) {
    verbose(`Syncing referral ${referral._id} (status: ${referral.status}, ahaBucket: ${referral.ahaBucket || 'none'})`);

    if (DRY_RUN) {
      stats.referralsSynced++;
      continue;
    }

    try {
      const result = await syncReferralTasks(referral._id);
      verbose(`  Created: ${result.created}, Skipped: ${result.skipped}`);
      stats.referralsSynced++;

      if (result.errors.length > 0) {
        for (const error of result.errors) {
          stats.errors.push(`Referral ${referral._id}: ${error}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stats.errors.push(`Failed to sync referral ${referral._id}: ${errorMessage}`);
    }
  }
}

async function syncOnboardingTasksForAgents(stats: MigrationStats) {
  log('\n=== Syncing Onboarding Tasks for Agents ===\n');

  const agents = await Agent.find({ active: true })
    .select('_id name')
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();

  log(`Found ${agents.length} active agents to sync`);

  for (const agent of agents) {
    verbose(`Syncing agent ${agent._id} (${agent.name})`);

    if (DRY_RUN) {
      stats.agentsSynced++;
      continue;
    }

    try {
      const result = await syncAgentOnboardingTasks(agent._id);
      verbose(`  Created: ${result.created}, Skipped: ${result.skipped}`);
      stats.agentsSynced++;

      if (result.errors.length > 0) {
        for (const error of result.errors) {
          stats.errors.push(`Agent ${agent._id}: ${error}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stats.errors.push(`Failed to sync agent ${agent._id}: ${errorMessage}`);
    }
  }
}

async function main() {
  console.log('\n========================================');
  console.log('Follow-Up Tasks Migration Script');
  console.log('========================================\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  console.log('Options:');
  console.log(`  --dry-run: ${DRY_RUN}`);
  console.log(`  --sync-static: ${SYNC_STATIC}`);
  console.log(`  --skip-manual: ${SKIP_MANUAL}`);
  console.log(`  --verbose: ${VERBOSE}`);

  await connectMongo();

  const stats: MigrationStats = {
    manualTasksCreated: 0,
    manualTasksSkipped: 0,
    completionsPreserved: 0,
    referralsSynced: 0,
    agentsSynced: 0,
    errors: [],
  };

  // Step 1: Migrate manual tasks
  if (!SKIP_MANUAL) {
    await migrateManualTasks(stats);
  } else {
    log('\n⏭️  Skipping manual task migration (--skip-manual)\n');
  }

  // Step 2: Sync static tasks for referrals (optional)
  if (SYNC_STATIC) {
    await syncStaticTasksForReferrals(stats);
    await syncOnboardingTasksForAgents(stats);
  } else {
    log('\n⏭️  Skipping static task sync (use --sync-static to enable)\n');
  }

  // Print summary
  console.log('\n========================================');
  console.log('Migration Summary');
  console.log('========================================\n');

  console.log(`Manual tasks created: ${stats.manualTasksCreated}`);
  console.log(`Manual tasks skipped (already exist): ${stats.manualTasksSkipped}`);
  console.log(`Completions preserved: ${stats.completionsPreserved}`);
  console.log(`Referrals synced: ${stats.referralsSynced}`);
  console.log(`Agents synced: ${stats.agentsSynced}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors (${stats.errors.length}):`);
    for (const error of stats.errors.slice(0, 20)) {
      console.log(`  - ${error}`);
    }
    if (stats.errors.length > 20) {
      console.log(`  ... and ${stats.errors.length - 20} more`);
    }
  } else {
    console.log('\n✅ No errors');
  }

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN - No changes were made. Run without --dry-run to apply changes.\n');
  } else {
    console.log('\n✅ Migration complete!\n');
  }

  process.exit(stats.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
