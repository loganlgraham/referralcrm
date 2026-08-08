import { MongoDBAdapter } from '@next-auth/mongodb-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import EmailProvider from 'next-auth/providers/email';
import bcrypt from 'bcryptjs';
import type { NextAuthOptions } from 'next-auth';
import { Resend } from 'resend';
import { connectMongo } from '@/lib/mongoose';
import { Types } from 'mongoose';
import { User } from '@/models/user';
import { z } from 'zod';
import { recordAgentLoginEvent } from '@/lib/server/agent-activity';

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
      try {
        const parsed = credentialsSchema.safeParse(credentials);

        if (!parsed.success) {
          if (process.env.NODE_ENV === 'development') {
            console.error('[Auth] Invalid credentials format:', parsed.error);
          }
          throw new Error('Invalid credentials submitted. Please check the form fields and try again.');
        }

        const { identifier, password } = parsed.data;

        // Attempt MongoDB connection with specific error handling
        try {
          await connectMongo();
        } catch (connectionError) {
          const errorMessage = connectionError instanceof Error ? connectionError.message : String(connectionError);
          const isSSLError = errorMessage.includes('SSL') || 
                            errorMessage.includes('TLS') || 
                            errorMessage.includes('tlsv1') ||
                            errorMessage.includes('certificate');
          
          if (process.env.NODE_ENV === 'development') {
            console.error('[Auth] MongoDB connection error:', {
              message: errorMessage,
              isSSLError,
              stack: connectionError instanceof Error ? connectionError.stack : undefined,
            });
          }

          // Return null for connection errors - NextAuth will handle this as a failed auth
          // This prevents unhandled errors from causing 401 responses
          if (isSSLError) {
            throw new Error('Database connection failed due to SSL/TLS error. Please contact support if this persists.');
          } else {
            throw new Error('Unable to connect to the database. Please try again or contact support if the problem persists.');
          }
        }

        const normalizedIdentifier = identifier.toLowerCase();
        const isEmail = /@/.test(normalizedIdentifier);

        const query = isEmail
          ? { email: normalizedIdentifier }
          : { username: normalizedIdentifier };

        let user;
        try {
          user = await User.findOne(query).select('+passwordHash role name email username');
        } catch (dbError) {
          const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
          if (process.env.NODE_ENV === 'development') {
            console.error('[Auth] Database query error:', errorMessage);
          }
          throw new Error('Database query failed. Please try again or contact support if the problem persists.');
        }

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
      } catch (error) {
        // Log all errors in development for debugging
        if (process.env.NODE_ENV === 'development') {
          console.error('[Auth] Authorization error:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }

        // Re-throw authentication errors (NextAuth will convert these to error messages)
        // This includes connection errors that we've wrapped with user-friendly messages
        if (error instanceof Error) {
          throw error;
        }

        // For unknown error types, throw a generic error
        throw new Error('An unexpected error occurred during authentication. Please try again.');
      }
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

const authSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

if (!authSecret) {
  console.error('[Auth] WARNING: NEXTAUTH_SECRET or AUTH_SECRET environment variable is not set. Authentication may fail.');
}

// Reuse mongoose's underlying MongoClient so auth shares the single connection
// pool instead of opening a second one (halves per-instance connections + monitoring).
const getAdapterClientPromise = () => connectMongo().then((m) => m.connection.getClient());

export async function persistUserLastLoginAt(input: { id?: string | null; email?: string | null }) {
  const userId = typeof input.id === 'string' && input.id.length > 0 ? input.id : null;
  const email =
    typeof input.email === 'string' && input.email.trim().length > 0
      ? input.email.trim().toLowerCase()
      : null;
  if (!userId && !email) {
    return;
  }

  const query =
    userId && Types.ObjectId.isValid(userId)
      ? { _id: new Types.ObjectId(userId) }
      : userId
        ? { _id: userId }
        : { email: email as string };

  await connectMongo();
  const result = await User.updateOne(query, { $set: { lastLoginAt: new Date() } });
  if (result.matchedCount === 0 && process.env.NODE_ENV === 'development') {
    console.warn('[Auth] lastLoginAt update matched no user for query:', {
      usedObjectId: Boolean(userId && Types.ObjectId.isValid(userId)),
      hasUserId: Boolean(userId),
      hasEmail: Boolean(email)
    });
  }
}

export const authOptions: NextAuthOptions = {
  adapter: MongoDBAdapter(getAdapterClientPromise() as any),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/auth/check-email',
  },
  secret: authSecret,
  providers,
  debug: process.env.NODE_ENV === 'development',
  events: {
    async signIn({ user }) {
      try {
        const signInUser = user as { id?: string | null; email?: string | null } | undefined;
        await persistUserLastLoginAt({
          id: signInUser?.id ?? null,
          email: signInUser?.email ?? null
        });
        await recordAgentLoginEvent({
          id: signInUser?.id ?? null,
          email: signInUser?.email ?? null
        });
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[Auth] Unable to persist last login timestamp:', error);
        }
      }
    }
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // @ts-ignore
        token.role = (user as any).role ?? token.role;
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

      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;
      // @ts-ignore
      session.user.id = token.sub as string;
      // @ts-ignore
      session.user.role = (token as any).role ?? null;
      return session;
    },
  },
};
