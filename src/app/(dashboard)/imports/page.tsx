import { Metadata } from 'next';
import { ImportWizard } from '@/components/imports/import-wizard';

export const metadata: Metadata = {
  title: 'Imports | Referral CRM'
};

export const dynamic = 'force-dynamic';

export default function ImportsPage() {
  return (
    <div className="max-w-4xl">
      <ImportWizard />
    </div>
  );
}
