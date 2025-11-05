export default function CheckEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-white p-8 text-center shadow-sm">
        <h1 className="text-3xl font-bold">Check your email</h1>
        <p className="text-gray-600">
          A sign-in link has been sent to your email address. Click the link to continue.
        </p>
      </div>
    </div>
  );
}
