import { MongoDBAdapter } from '@next-auth/mongodb-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import EmailProvider from 'next-auth/providers/email';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { Resend } from 'resend';
import { getClientPromise } from '@/lib/mongodb-client';
import { connectMongo } from '@/lib/mongoose';
import { User } from '@/models/user';
import { z } from 'zod';

const roleValues = ['agent', 'mortgage-consultant', 'admin'] as const;
type Role = (typeof roleValues)[number];

const credentialsSchema = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase()),
  role: z.enum(roleValues),
});

const providers: NextAuthOptions['providers'] = [];

providers.push(
  CredentialsProvider({
    name: 'Standard Login',
    credentials: {
      email: { label: 'Email', type: 'email' },
      role: { label: 'Role', type: 'text' },
    },
    async authorize(credentials) {
      const parsed = credentialsSchema.safeParse(credentials);

      if (!parsed.success) {
        throw new Error('Invalid credentials submitted. Please check the form fields and try again.');
      }

      const { email, role } = parsed.data;

      await connectMongo();

      const user = await User.findOne({ email });

      if (!user) {
        throw new Error('No account found for this email address. Please sign up first.');
      }

      const storedRole = (user.role as Role | null) ?? null;

      if (storedRole && storedRole !== role) {
        throw new Error('The selected role does not match the role assigned to this account.');
      }

      if (!storedRole) {
        if (role === 'admin') {
          throw new Error('Admin access requires an administrator to approve your account.');
        }

        user.role = role;
        await user.save();
      }

      return {
        id: user._id.toString(),
        email: user.email,
        name: user.name ?? undefined,
        role: (user.role as Role | undefined) ?? role,
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
    async jwt({ token, user }) {
      if (user) {
        // @ts-ignore
        token.role = (user as any).role ?? token.role;
      }
      if (!('role' in token) && token.sub) {
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
