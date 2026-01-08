import 'dotenv/config';
import { connectMongo } from '../src/lib/mongoose';
import { User } from '../src/models/user';

async function main() {
  await connectMongo();

  console.log('Resetting reminder email defaults for all users...');

  const result = await User.updateMany(
    {},
    {
      $set: { reminderEnabled: false },
    }
  );

  console.log(`✓ Updated ${result.modifiedCount} user(s)`);
  console.log(`✓ Total users matched: ${result.matchedCount}`);

  if (result.modifiedCount > 0) {
    console.log('\nAll users now have reminder emails disabled by default.');
    console.log('Users can manually enable reminders through the settings UI.');
  } else {
    console.log('\nNo users needed updating (all already have reminders disabled).');
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Error resetting reminder defaults:', error);
  process.exit(1);
});
