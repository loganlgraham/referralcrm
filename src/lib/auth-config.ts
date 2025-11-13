import { MongoDBAdapter } from '@next-auth/mongodb-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import EmailProvider from 'next-auth/providers/email';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import type { NextAuthOptions } from 'next-auth';
import { Resend } from 'resend';
import { ObjectId } from 'mongodb';
import { getClientPromise } from '@/lib/mongodb-client';
import { connectMongo } from '@/lib/mongoose';
import { User } from '@/models/user';
import { z } from 'zod';

const roleValues = ['agent', 'mortgage-consultant', 'admin'] as const;
type Role = (typeof roleValues)[number];

const credentialsSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

const providers: NextAuthOptions['providers'] = [];

providers.push(
  CredentialsProvider({
    name: 'Standard Login',
    credentials: {
      identifier: { label: 'Username or email', type: 'text' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      const parsed = credentialsSchema.safeParse(credentials);

      if (!parsed.success) {
        throw new Error('Invalid credentials submitted. Please check the form fields and try again.');
      }

      const { identifier, password } = parsed.data;

      await connectMongo();

      const normalizedIdentifier = identifier.toLowerCase();
      const isEmail = /@/.test(normalizedIdentifier);

      const query = isEmail
        ? { email: normalizedIdentifier }
        : { username: normalizedIdentifier };

      const user = await User.findOne(query).select('+passwordHash role name email username');

      if (!user) {
        throw new Error('No account found for this username or email. Please sign up first.');
      }

      if (!user.passwordHash) {
        throw new Error('This account has not been configured with a password. Please reset your password or contact support.');
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        throw new Error('Incorrect password. Please try again.');
      }

      const storedRole = (user.role as Role | null) ?? null;

      if (!storedRole) {
        throw new Error('This account does not have a role assigned. Please contact an administrator.');
      }

      return {
        id: user._id.toString(),
        email: user.email,
        name: user.name ?? undefined,
        username: user.username,
        role: storedRole,
      } as any;
    },
  })
);

// Email via Resend or SMTP
if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  providers.push(
    EmailProvider({
      from: process.env.EMAIL_FROM,
      async sendVerificationRequest({ identifier, url, provider }) {
        const host = new URL(url).host;
        await resend.emails.send({
          from: provider.from as string,
          to: identifier,
          subject: `Sign in to ${host}`,
          html: `<p>Click the link below to sign in to ${host}:</p><p><a href="${url}">Sign in</a></p>`,
          text: `Sign in to ${host}:\n${url}`,
        });
      },
    })
  );
} else if (process.env.EMAIL_SERVER && process.env.EMAIL_FROM) {
  providers.push(
    EmailProvider({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    })
  );
}

// Google only if configured
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
        },
      },
    })
  );
}

const authSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

export const authOptions: NextAuthOptions = {
  adapter: MongoDBAdapter(getClientPromise() as any),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/auth/check-email',
  },
  secret: authSecret,
  providers,
  debug: process.env.NODE_ENV === 'development',
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        // @ts-ignore
        token.role = (user as any).role ?? token.role;
      }

      if (account?.provider === 'google') {
        (token as any).googleCalendarConnected = Boolean(
          account.scope?.includes('https://www.googleapis.com/auth/calendar.events')
        );
      }

      if ((token as any).googleCalendarConnected === undefined) {
        (token as any).googleCalendarConnected = null;
      }

      const role = (token as any).role;
      const shouldRefreshRole =
        (!role || role === 'viewer') && typeof token.sub === 'string' && token.sub.length > 0;

      if (shouldRefreshRole) {
        try {
          await connectMongo();
          const u = await User.findById(token.sub).select('role').lean();
          // @ts-ignore
          token.role = u?.role ?? null;
        } catch {}
      }

      if ((token as any).googleCalendarConnected === null && typeof token.sub === 'string') {
        try {
          const client = await getClientPromise();
          const accounts = client.db().collection('accounts');
          const objectId = new ObjectId(token.sub);
          const accountDoc = await accounts.findOne({ provider: 'google', userId: objectId });
          (token as any).googleCalendarConnected = Boolean(
            accountDoc?.scope?.includes('https://www.googleapis.com/auth/calendar.events')
          );
        } catch {
          (token as any).googleCalendarConnected = false;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;
      // @ts-ignore
      session.user.id = token.sub as string;
      // @ts-ignore
      session.user.role = (token as any).role ?? null;
      const sessionUser = session.user as typeof session.user & {
        googleCalendarConnected?: boolean;
      };
      sessionUser.googleCalendarConnected = Boolean((token as any).googleCalendarConnected);
      return session;
    },
  },
};
