import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { PasswordResetToken } from '@/models/password-reset-token';
import { User } from '@/models/user';

const resetSchema = z.object({
  email: z.string().email('Please provide a valid email').transform((value) => value.trim().toLowerCase()),
  token: z.string().min(1, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(100, 'Password must be at most 100 characters long'),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = resetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { email, token, password } = parsed.data;

  try {
    await connectMongo();

    const user = await User.findOne({ email }).select('_id email');

    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired reset token.' }, { status: 400 });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const resetRecord = await PasswordResetToken.findOne({
      userId: user._id,
      tokenHash: hashedToken,
      expiresAt: { $gt: new Date() },
    });

    if (!resetRecord) {
      return NextResponse.json({ error: 'Invalid or expired reset token.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await User.updateOne({ _id: user._id }, { passwordHash });
    await PasswordResetToken.deleteMany({ userId: user._id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to reset password', error);
    return NextResponse.json({ error: 'Unable to reset password right now. Please try again later.' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'Method not allowed. Use POST instead.' }, {
    status: 405,
    headers: { Allow: 'POST' },
  });
}
