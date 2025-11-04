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
    async session({ session, token }) {
      if (!session.user) return session;
      session.user.id = token.sub!;
      (session.user as any).role = (token as any).role || 'viewer';
      (session.user as any).org = (token as any).org || 'AFC';
      return session;
    },
    async jwt({ token }) {
      if (!token.email) return token;
      await connectMongo();
      const user = await User.findOne({ email: token.email });
      if (user) {
        (token as any).role = user.role;
        (token as any).org = user.org;
      }
      return token;
    }
  }
};
