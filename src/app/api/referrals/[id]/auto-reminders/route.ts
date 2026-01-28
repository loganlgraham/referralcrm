import { NextRequest, NextResponse } from 'next/server';

import { getCurrentSession, requireAdmin } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';

interface Params {
  params: { id: string };
}

/**
 * PATCH /api/referrals/[id]/auto-reminders
 * Toggle automated update reminders for a referral
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await requireAdmin();
    const body = await request.json();
    const { enabled } = body as { enabled: boolean };

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    await connectMongo();

    const referral = await Referral.findById(params.id);

    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    // Update the automation setting
    referral.autoUpdateRemindersEnabled = enabled;

    // Add audit entry
    referral.audit = referral.audit || [];
    referral.audit.push({
      actorId: session.user.id,
      actorRole: session.user.role,
      field: 'autoUpdateRemindersEnabled',
      previousValue: !enabled,
      newValue: enabled,
      timestamp: new Date(),
    } as any);

    await referral.save();

    return NextResponse.json({
      success: true,
      autoUpdateRemindersEnabled: enabled,
    });
  } catch (error) {
    console.error('Error toggling auto reminders:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle auto reminders' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/referrals/[id]/auto-reminders
 * Get current automation status
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    await connectMongo();

    const referral = await Referral.findById(params.id)
      .select('autoUpdateRemindersEnabled')
      .lean<{ autoUpdateRemindersEnabled?: boolean } | null>();

    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    return NextResponse.json({
      autoUpdateRemindersEnabled: referral.autoUpdateRemindersEnabled || false,
    });
  } catch (error) {
    console.error('Error fetching auto reminders status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
