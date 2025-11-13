import NextAuth from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: 'admin' | 'manager' | 'mc' | 'agent' | 'viewer';
      org: 'AFC' | 'AHA';
      googleCalendarConnected?: boolean;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string;
    org?: string;
    googleCalendarConnected?: boolean;
  }
}

export {};
