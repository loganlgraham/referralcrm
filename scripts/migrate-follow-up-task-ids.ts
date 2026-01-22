/**
 * One-off migration: normalize taskIds in FollowUpTaskState documents to use
 * the referralId:: prefix. Legacy docs may store taskId without prefix (e.g.
 * "assign-agent-status"); we rewrite to "referralId::assign-agent-status".
 *
 * Run: pnpm tsx scripts/migrate-follow-up-task-ids.ts
 */
import 'dotenv/config';
import { connectMongo } from '../src/lib/mongoose';
import { FollowUpTaskState } from '../src/models/follow-up-task-state';
import type { FollowUpTaskCompletion, FollowUpTaskMetadata } from '../src/models/follow-up-task-state';

function normalizeTaskId(taskId: string, referralId: string | undefined): string {
  if (!referralId) return taskId;
  const prefix = `${referralId}::`;
  return taskId.startsWith(prefix) ? taskId : `${prefix}${taskId}`;
}

async function main() {
  await connectMongo();

  console.log('Migrating FollowUpTaskState taskIds to referralId:: prefix...\n');

  const docs = await FollowUpTaskState.find({}).lean<
    Array<{
      _id: unknown;
      referralId?: string;
      completions?: FollowUpTaskCompletion[];
      manualTasks?: unknown[];
      shownTasks?: string[];
      taskMetadata?: FollowUpTaskMetadata[];
    }>
  >();

  let updated = 0;
  let skipped = 0;
  for (const doc of docs) {
    const referralId = typeof doc.referralId === 'string' ? doc.referralId : undefined;
    
    // Skip documents with missing or invalid referralId to prevent corrupting data
    if (!referralId) {
      skipped++;
      console.log(`  ⚠ Skipping document ${doc._id}: missing or invalid referralId`);
      continue;
    }
    let completionsChanged = false;
    let metadataChanged = false;

    const completions = Array.isArray(doc.completions) ? [...doc.completions] : [];
    for (let i = 0; i < completions.length; i++) {
      const c = completions[i];
      if (!c || typeof c.taskId !== 'string') continue;
      const normalized = normalizeTaskId(c.taskId, referralId);
      if (normalized !== c.taskId) {
        completions[i] = { ...c, taskId: normalized };
        completionsChanged = true;
      }
    }

    const taskMetadata = Array.isArray(doc.taskMetadata) ? [...doc.taskMetadata] : [];
    for (let i = 0; i < taskMetadata.length; i++) {
      const m = taskMetadata[i];
      if (!m || typeof m.taskId !== 'string') continue;
      const normalized = normalizeTaskId(m.taskId, referralId);
      if (normalized !== m.taskId) {
        taskMetadata[i] = { ...m, taskId: normalized };
        metadataChanged = true;
      }
    }

    if (completionsChanged || metadataChanged) {
      await FollowUpTaskState.updateOne(
        { _id: doc._id },
        {
          $set: {
            ...(completionsChanged && { completions }),
            ...(metadataChanged && { taskMetadata }),
          },
        }
      );
      updated++;
      console.log(`  ✓ ${referralId} (completions: ${completionsChanged}, taskMetadata: ${metadataChanged})`);
    }
  }

  console.log(`\nDone. Updated ${updated} / ${docs.length} document(s).`);
  if (skipped > 0) {
    console.log(`  ⚠ Skipped ${skipped} document(s) with missing or invalid referralId.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
