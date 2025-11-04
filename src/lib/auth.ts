import { MongoDBAdapter } from '@next-auth/mongodb-adapter';
import { getToken } from 'next-auth/jwt';
import NextAuth, { NextAuthOptions, Session } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import GoogleProvider from 'next-auth/providers/google';
import clientPromise from '@/lib/mongodb-client';
import { connectMongo } from '@/lib/mongoose';
import { User } from '@/models/user';

export const authOptions: NextAuthOptions = {
  adapter: MongoDBAdapter(clientPromise),
  session: {
    strategy: 'jwt'
  },
  pages: {
    signIn: '/login'
  },
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
      session.user.role = (token.role as Session['user']['role']) || 'viewer';
      session.user.org = (token.org as Session['user']['org']) || 'AFC';
      return session;
    },
    async jwt({ token }) {
      if (!token.email) return token;
      await connectMongo();
      const user = await User.findOne({ email: token.email });
      if (user) {
        token.role = user.role;
        token.org = user.org;
      }
      return token;
    }
  }
};

export const {
  auth,
  signIn,
  signOut
} = NextAuth(authOptions);

export async function getCurrentSession() {
  return auth();
}

export async function getSessionToken(req: Request) {
  const headers = Object.fromEntries(req.headers);
  return getToken({ 
    req: { headers } as any, 
    secret: process.env.NEXTAUTH_SECRET 
  });
}
