'use client';

import { useState } from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { toast } from 'sonner';

const steps = ['Upload', 'Map Fields', 'Preview', 'Confirm'] as const;

const ENTITY_FIELDS: Record<string, string[]> = {
  Referral: [
    'borrowerName',
    'borrowerEmail',
    'borrowerPhone',
    'source',
    'endorser',
    'clientType',
    'lookingInZip',
    'borrowerCurrentAddress',
    'stageOnTransfer',
    'loanFileNumber',
    'initialNotes',
    'status',
    'createdAt'
  ],
  Agent: ['name', 'email', 'phone', 'statesLicensed', 'zipCoverage'],
  LenderMC: ['name', 'email', 'phone', 'nmlsId', 'team', 'region'],
  Payment: ['referralId', 'status', 'expectedAmountCents', 'receivedAmountCents', 'invoiceDate', 'paidDate']
};

export function ImportWizard() {
  const [step, setStep] = useState<typeof steps[number]>('Upload');
  const [entity, setEntity] = useState<keyof typeof ENTITY_FIELDS>('Referral');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [file, setFile] = useState<File | null>(null);

  const parseFile = async (fileToParse: File): Promise<Papa.ParseResult<Record<string, string>>> => {
    if (fileToParse.name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(fileToParse);
      const firstEntry = zip.file(/.*/)[0];
      if (!firstEntry) throw new Error('Zip file is empty');
      const content = await firstEntry.async('string');
      return Papa.parse<Record<string, string>>(content, { header: true });
    }
    return new Promise<Papa.ParseResult<Record<string, string>>>((resolve, reject) => {
      Papa.parse<Record<string, string>>(fileToParse, {
        header: true,
        complete: resolve,
        error: reject
      });
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    try {
      const result = await parseFile(selected);
      setFile(selected);
      setHeaders(result.meta.fields || []);
      setRows(result.data.slice(0, 20) as Record<string, string>[]);
      setMapping({});
      setStep('Map Fields');
    } catch (error) {
      console.error(error);
      toast.error('Unable to parse file');
    }
  };

  const handleMappingChange = (source: string, target: string) => {
    setMapping((prev) => ({ ...prev, [source]: target }));
  };

  const handleConfirm = async () => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity', entity);
      formData.append('mapping', JSON.stringify(mapping));
      const res = await fetch('/api/imports', {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        throw new Error('Import failed');
      }
      toast.success('Import started');
      setStep('Upload');
      setFile(null);
      setHeaders([]);
      setRows([]);
      setMapping({});
    } catch (error) {
      console.error(error);
      toast.error('Unable to start import');
    }
  };

  return (
    <div className="space-y-6 rounded-lg bg-white p-6 shadow-sm">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Import Wizard</h1>
        <p className="text-sm text-slate-500">Upload CSV/XLSX/ZIP files and map to CRM fields.</p>
      </div>
      <div className="flex items-center gap-4 text-sm text-slate-500">
        {steps.map((item) => (
          <div key={item} className={`flex items-center gap-2 ${step === item ? 'font-semibold text-brand' : ''}`}>
            <span className="h-8 w-8 rounded-full border border-slate-300 text-center leading-8">{steps.indexOf(item) + 1}</span>
            {item}
          </div>
        ))}
      </div>
      {step === 'Upload' && (
        <div className="space-y-4">
          <label className="text-sm font-medium text-slate-600">
            Entity
            <select
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              value={entity}
              onChange={(event) => setEntity(event.target.value as keyof typeof ENTITY_FIELDS)}
            >
              {Object.keys(ENTITY_FIELDS).map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
          </label>
          <input type="file" accept=".csv,.xlsx,.xls,.zip" onChange={handleFileChange} />
        </div>
      )}
      {step === 'Map Fields' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Map columns to CRM fields.</p>
          {headers.map((header) => (
            <div key={header} className="flex items-center justify-between gap-4 rounded border border-slate-200 px-3 py-2">
              <span className="text-sm font-medium text-slate-700">{header}</span>
              <select
                value={mapping[header] ?? ''}
                onChange={(event) => handleMappingChange(header, event.target.value)}
                className="rounded border border-slate-200 px-2 py-1 text-sm"
              >
                <option value="">Ignore</option>
                {ENTITY_FIELDS[entity].map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button
            type="button"
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"
            onClick={() => setStep('Preview')}
          >
            Continue
          </button>
        </div>
      )}
      {step === 'Preview' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Preview first 20 rows.</p>
          <div className="max-h-64 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="border-b bg-slate-50 px-2 py-1 text-left text-xs uppercase text-slate-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="odd:bg-white even:bg-slate-50">
                    {headers.map((header) => (
                      <td key={header} className="px-2 py-1">
                        {row[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="rounded border border-slate-300 px-4 py-2 text-sm" onClick={() => setStep('Map Fields')}>
              Back
            </button>
            <button type="button" className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white" onClick={() => setStep('Confirm')}>
              Continue
            </button>
          </div>
        </div>
      )}
      {step === 'Confirm' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Confirm mapping and start import.</p>
          <pre className="max-h-40 overflow-auto rounded bg-slate-900 p-4 text-xs text-white">{JSON.stringify(mapping, null, 2)}</pre>
          <div className="flex items-center gap-3">
            <button type="button" className="rounded border border-slate-300 px-4 py-2 text-sm" onClick={() => setStep('Preview')}>
              Back
            </button>
            <button type="button" className="rounded bg-brand px-4 py-2 text-sm font-semibold text-white" onClick={handleConfirm}>
              Start import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
