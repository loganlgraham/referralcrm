'use client';

// ...existing imports...
import Link from 'next/link';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  // ...existing state and handlers...
  return (
    // ...existing markup...
    <div className="space-y-4">
      {/* ...existing login buttons/forms... */}
      <button className="w-full rounded-md bg-black text-white py-2" onClick={() => signIn('google')}>Sign in with Google</button>
      <button className="w-full rounded-md border py-2" onClick={() => signIn('email')}>Sign in with Email</button>
      <p className="text-sm text-gray-600 text-center mt-4">
        New here? <Link className="underline" href="/signup">Create an account</Link>
      </p>
    </div>
  );
}
