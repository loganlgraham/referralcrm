import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAuthorizedIntakeMessage } from '@/lib/server/referral-intake-files';

type IntakeAttachment = { id: string; filename: string };

async function listIntakeFiles(messageId: string): Promise<IntakeAttachment[] | null> {
  try {
    const response = await fetch('https://api.resend.com/emails/receiving/' + encodeURIComponent(messageId), {
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const email = payload.data ?? payload;
    if (email.id !== messageId || !Array.isArray(email.attachments)) return null;
    return email.attachments.filter((file: Partial<IntakeAttachment> | null) =>
      file && typeof file.id === 'string' && typeof file.filename === 'string'
    );
  } catch {
    return null;
  }
}

export default async function IntakeFilesPage({ params }: { params: { id: string } }) {
  const messageId = await getAuthorizedIntakeMessage(params.id);
  if (!messageId) notFound();
  const files = await listIntakeFiles(messageId);

  return (
    <section className="space-y-4">
      <Link className="underline" href={`/referrals/${params.id}`}>Back to referral</Link>
      <h1 className="text-2xl font-semibold">Intake email attachments</h1>
      {files?.length ? (
        <ul className="space-y-2">
          {files.map((file) => (
            <li key={file.id}>
              <a className="underline" href={`/api/referrals/${params.id}/intake-attachments/${encodeURIComponent(file.id)}`}>
                {file.filename}
              </a>
            </li>
          ))}
        </ul>
      ) : <p>{files ? 'This email had no attachments.' : 'The email provider is unavailable. Please try again.'}</p>}
    </section>
  );
}
