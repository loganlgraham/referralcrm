import { connectMongo } from '@/lib/mongoose';
import { EmailAddressHealth } from '@/models/email-address-health';

/**
 * How long an address stays off CC lines after each consecutive bounce. Once the window
 * lapses the address gets one probe send; if that bounces too it backs off further, and if
 * it lands the address is restored. Capped so a recovered mailbox is never locked out.
 */
const BACKOFF_MS = [
  60 * 60 * 1000, // 1 hour
  6 * 60 * 60 * 1000, // 6 hours
  24 * 60 * 60 * 1000, // 1 day
  3 * 24 * 60 * 60 * 1000, // 3 days
  7 * 24 * 60 * 60 * 1000, // 7 days
];

const resolveBackoffMs = (consecutiveBounces: number): number => {
  const index = Math.min(Math.max(consecutiveBounces, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index];
};

const normalize = (address: string): string => address.trim().toLowerCase();

export type AddressHealthPartition = {
  healthy: string[];
  withheld: string[];
};

/**
 * Splits addresses into those safe to send to and those currently in a bounce backoff window.
 * Failures here are non-fatal: if the lookup breaks we treat every address as healthy rather
 * than silently dropping recipients.
 */
export async function partitionByHealth(addresses: string[]): Promise<AddressHealthPartition> {
  if (addresses.length === 0) {
    return { healthy: [], withheld: [] };
  }

  try {
    await connectMongo();
    const normalized = addresses.map(normalize);
    const records = await EmailAddressHealth.find({ address: { $in: normalized } })
      .select('address bouncing suppressedUntil')
      .lean<Array<{ address: string; bouncing?: boolean; suppressedUntil?: Date | null }>>();

    const now = Date.now();
    const suppressed = new Set<string>();
    for (const record of records) {
      if (!record.bouncing) {
        continue;
      }
      const until = record.suppressedUntil;
      // A lapsed window means it is time to probe the address again.
      if (until instanceof Date && !Number.isNaN(until.getTime()) && until.getTime() <= now) {
        continue;
      }
      suppressed.add(record.address);
    }

    const healthy: string[] = [];
    const withheld: string[] = [];
    for (const address of addresses) {
      if (suppressed.has(normalize(address))) {
        withheld.push(address);
      } else {
        healthy.push(address);
      }
    }

    return { healthy, withheld };
  } catch (error) {
    console.error('[EmailHealth] Failed to check address health, treating all as healthy', error);
    return { healthy: [...addresses], withheld: [] };
  }
}

export async function recordBounce(addresses: string[], reason: string | null): Promise<void> {
  if (addresses.length === 0) {
    return;
  }

  try {
    await connectMongo();
    const now = new Date();

    await Promise.all(
      addresses.map(async (address) => {
        const normalized = normalize(address);
        const existing = await EmailAddressHealth.findOne({ address: normalized })
          .select('consecutiveBounces')
          .lean<{ consecutiveBounces?: number } | null>();

        const consecutiveBounces = (existing?.consecutiveBounces ?? 0) + 1;

        await EmailAddressHealth.updateOne(
          { address: normalized },
          {
            $set: {
              bouncing: true,
              consecutiveBounces,
              suppressedUntil: new Date(now.getTime() + resolveBackoffMs(consecutiveBounces)),
              lastBounceAt: now,
              lastBounceReason: reason,
            },
          },
          { upsert: true }
        );
      })
    );
  } catch (error) {
    console.error('[EmailHealth] Failed to record bounce', error);
  }
}

export async function recordDelivery(addresses: string[]): Promise<void> {
  if (addresses.length === 0) {
    return;
  }

  try {
    await connectMongo();
    await EmailAddressHealth.updateMany(
      { address: { $in: addresses.map(normalize) } },
      {
        $set: {
          bouncing: false,
          consecutiveBounces: 0,
          suppressedUntil: null,
          lastDeliveredAt: new Date(),
        },
      }
    );
  } catch (error) {
    console.error('[EmailHealth] Failed to record delivery', error);
  }
}
