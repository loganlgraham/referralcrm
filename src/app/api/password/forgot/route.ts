import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { connectMongo } from '@/lib/mongoose';
import { PasswordResetToken } from '@/models/password-reset-token';
import { User } from '@/models/user';

const requestSchema = z.object({
  email: z.string().email('Please provide a valid email').transform((value) => value.trim().toLowerCase()),
});

function buildResetUrl(request: Request, token: string, email: string): string {
  const url = new URL('/auth/reset-password', request.url);
  url.searchParams.set('token', token);
  url.searchParams.set('email', email);
  return url.toString();
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  if (!isTransactionalEmailConfigured()) {
    return NextResponse.json(
      { error: 'Password reset email is not configured. Please contact an administrator.' },
      { status: 503 }
    );
  }

  const { email } = parsed.data;

  try {
    await connectMongo();

    const user = await User.findOne({ email }).select('_id email name');

    if (!user) {
      return NextResponse.json({ ok: true });
    }

    await PasswordResetToken.deleteMany({ userId: user._id });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    const resetUrl = buildResetUrl(request, token, email);

    const emailSent = await sendTransactionalEmail({
      to: [email],
      subject: 'Reset your Referral CRM password',
      html: `<p>Hi ${user.name ?? 'there'},</p><p>We received a request to reset your Referral CRM password. Click the link below to set a new password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link will expire in 30 minutes. If you did not request this, you can safely ignore this email.</p>`,
      text: `Hi ${user.name ?? 'there'},\n\nUse the link below to reset your Referral CRM password. This link expires in 30 minutes.\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    });

    if (!emailSent) {
      return NextResponse.json({ error: 'Unable to send reset email right now. Please try again later.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to start password reset', error);
    return NextResponse.json({ error: 'Unable to process password reset at this time.' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'Method not allowed. Use POST instead.' }, {
    status: 405,
    headers: { Allow: 'POST' },
  });
}
