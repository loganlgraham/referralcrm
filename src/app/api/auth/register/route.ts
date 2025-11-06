import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectMongo } from '@/lib/mongoose';
import { User } from '@/models/user';
import { z } from 'zod';

const roleValues = ['agent', 'mortgage-consultant', 'admin'] as const;

const payloadSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z
    .string()
    .email('Please provide a valid email address')
    .transform((value) => value.trim().toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(100, 'Password must be at most 100 characters long'),
  role: z.enum(roleValues),
  adminSecret: z.string().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const parsed = payloadSchema.safeParse(body);

  if (!parsed.success) {
    const errors = parsed.error.flatten();
    return NextResponse.json(
      {
        error: 'Invalid signup request',
        details: errors.fieldErrors,
      },
      { status: 400 }
    );
  }

  const { name, email, password, role, adminSecret } = parsed.data;

  if (role === 'admin') {
    const expectedSecret = process.env.ADMIN_SIGNUP_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        { error: 'Admin signups are currently disabled. Please contact support.' },
        { status: 503 }
      );
    }

    if (adminSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid admin signup code provided.' }, { status: 403 });
    }
  }

  try {
    await connectMongo();

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try logging in instead.' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email,
      role,
      emailVerified: new Date(),
      passwordHash,
    });

    return NextResponse.json(
      {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to register user', error);
    return NextResponse.json(
      { error: 'Unexpected error while creating the account. Please try again.' },
      { status: 500 }
    );
  }
}
