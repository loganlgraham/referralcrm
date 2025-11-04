import { MongoDBAdapter } from '@next-auth/mongodb-adapter';
import EmailProvider from 'next-auth/providers/email';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { getClientPromise } from '@/lib/mongodb-client';
import { connectMongo } from '@/lib/mongoose';
import { User } from '@/models/user';

export const authOptions: NextAuthOptions = {
  adapter: MongoDBAdapter(getClientPromise() as any),
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    EmailProvider({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || ''
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On first login, copy role from user record if present
      if (user) {
        // @ts-ignore
        token.role = (user as any).role ?? token.role;
      }
      // If still missing, try to load once from DB
      if (!('role' in token) && token.sub) {
        try {
          await connectMongo();
          const u = await User.findById(token.sub).select('role').lean();
          // @ts-ignore
          token.role = u?.role ?? null;
        } catch {
          // ignore DB errors here
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;
      // Expose id and role on session
      // @ts-ignore
      session.user.id = token.sub as string;
      // @ts-ignore
      session.user.role = (token as any).role ?? null;
      return session;
    },
  }
};
