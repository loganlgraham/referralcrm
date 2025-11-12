'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  'Mortgage Consultant': ['name', 'email', 'phone', 'nmlsId', 'team', 'region'],
  Deal: [
    'referralId',
    'status',
    'expectedAmountCents',
    'receivedAmountCents',
    'invoiceDate',
    'paidDate',
    'terminatedReason',
    'agentOutcome',
    'usedAfc',
    'agentAttribution',
    'agentAttributionType',
    'notes'
  ]
};

type ImportAssistantInsights = {
  mappingSuggestions?: Record<string, string>;
  rowIssues?: { rowIndex: number; message: string }[];
  standardizedRows?: Record<string, string>[];
  notes?: string[];
};

export function ImportWizard() {
  const [step, setStep] = useState<typeof steps[number]>('Upload');
  const [entity, setEntity] = useState<keyof typeof ENTITY_FIELDS>('Referral');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [assistantInsights, setAssistantInsights] = useState<ImportAssistantInsights | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [useStandardizedPreview, setUseStandardizedPreview] = useState(true);
  const standardizedRows = assistantInsights?.standardizedRows ?? [];
  const hasStandardizedRows = standardizedRows.length === rows.length && standardizedRows.length > 0;
  const mappingSuggestionEntries = Object.entries(assistantInsights?.mappingSuggestions ?? {});
  const rowIssues = assistantInsights?.rowIssues ?? [];
  const assistantNotes = assistantInsights?.notes ?? [];

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
      setAssistantInsights(null);
      setAssistantError(null);
      setUseStandardizedPreview(true);
      setStep('Map Fields');
    } catch (error) {
      console.error(error);
      toast.error('Unable to parse file');
    }
  };

  const handleMappingChange = (source: string, target: string) => {
    setMapping((prev) => ({ ...prev, [source]: target }));
  };

  const fetchAssistantInsights = useCallback(async () => {
    if (!headers.length || !rows.length) return;
    setAssistantLoading(true);
    setAssistantError(null);
    try {
      const response = await fetch('/api/imports/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, headers, rows })
      });
      if (!response.ok) {
        let message = 'Unable to fetch assistant insights';
        try {
          const errorPayload = await response.json();
          if (typeof errorPayload?.error === 'string') {
            message = errorPayload.error;
          }
        } catch (jsonError) {
          const fallback = await response.text();
          if (fallback) {
            message = fallback;
          }
        }
        throw new Error(message);
      }
      const data = (await response.json()) as ImportAssistantInsights;
      setAssistantInsights(data);
    } catch (error) {
      console.error(error);
      setAssistantInsights(null);
      setAssistantError(
        error instanceof Error
          ? error.message
          : 'Import assistant unavailable. Try again later.'
      );
    } finally {
      setAssistantLoading(false);
    }
  }, [entity, headers, rows]);

  useEffect(() => {
    if (step === 'Map Fields' && headers.length && rows.length) {
      void fetchAssistantInsights();
    }
  }, [fetchAssistantInsights, headers.length, rows.length, step]);

  useEffect(() => {
    setUseStandardizedPreview(hasStandardizedRows);
  }, [hasStandardizedRows]);

  const handleApplyMappingSuggestions = () => {
    if (!assistantInsights?.mappingSuggestions) return;
    setMapping((previous) => {
      const next = { ...previous };
      Object.entries(assistantInsights.mappingSuggestions ?? {}).forEach(([column, field]) => {
        if (ENTITY_FIELDS[entity]?.includes(field)) {
          next[column] = field;
        }
      });
      return next;
    });
    toast.success('Mapping suggestions applied');
  };

  const previewRows = useMemo(() => {
    if (useStandardizedPreview && hasStandardizedRows) {
      return standardizedRows;
    }
    return rows;
  }, [hasStandardizedRows, rows, standardizedRows, useStandardizedPreview]);

  const handleConfirm = async () => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity', entity);
      formData.append('mapping', JSON.stringify(mapping));
      if (assistantInsights) {
        formData.append('assistantInsights', JSON.stringify(assistantInsights));
      }
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
      setAssistantInsights(null);
      setAssistantError(null);
      setUseStandardizedPreview(true);
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
          <div className="rounded border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">Import Assistant</h2>
                <p className="text-xs text-slate-500">AI suggestions to speed up mapping and data cleanup.</p>
              </div>
              <button
                type="button"
                onClick={() => void fetchAssistantInsights()}
                disabled={assistantLoading}
                className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {assistantLoading ? 'Analyzing…' : 'Refresh'}
              </button>
            </div>
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              {assistantLoading && <p className="text-slate-500">Analyzing sample rows…</p>}
              {!assistantLoading && assistantError && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm text-red-600">{assistantError}</span>
                  <button
                    type="button"
                    onClick={() => void fetchAssistantInsights()}
                    className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600"
                  >
                    Try again
                  </button>
                </div>
              )}
              {!assistantLoading && !assistantError && (
                <>
                  {mappingSuggestionEntries.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested matches</p>
                      <ul className="mt-2 space-y-1 text-xs">
                        {mappingSuggestionEntries.map(([column, field]) => (
                          <li key={column} className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1">
                            <span className="font-medium text-slate-700">{column}</span>
                            <span className="text-slate-500">→ {field}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No mapping suggestions yet.</p>
                  )}
                  {assistantNotes.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assistant notes</p>
                      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                        {assistantNotes.map((note, index) => (
                          <li key={`${note}-${index}`}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {rowIssues.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Flagged rows</p>
                      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                        {rowIssues.map((issue) => (
                          <li key={`${issue.rowIndex}-${issue.message}`}>
                            Row {issue.rowIndex + 1}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleApplyMappingSuggestions}
                disabled={assistantLoading || mappingSuggestionEntries.length === 0}
                className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply suggestions
              </button>
            </div>
          </div>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">Preview first 20 rows.</p>
            {hasStandardizedRows && (
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-slate-300"
                  checked={useStandardizedPreview}
                  onChange={(event) => setUseStandardizedPreview(event.target.checked)}
                />
                Use AI-cleaned preview
              </label>
            )}
          </div>
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
                {previewRows.map((row, index) => (
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
          {(rowIssues.length > 0 || assistantNotes.length > 0) && (
            <div className="rounded border border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-600">
              {assistantNotes.length > 0 && (
                <div className="space-y-1">
                  <p className="font-semibold uppercase tracking-wide text-slate-500">Assistant notes</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {assistantNotes.map((note, index) => (
                      <li key={`preview-note-${index}`}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
              {rowIssues.length > 0 && (
                <div className="space-y-1">
                  <p className="font-semibold uppercase tracking-wide text-slate-500">Flagged rows</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {rowIssues.map((issue) => (
                      <li key={`preview-issue-${issue.rowIndex}-${issue.message}`}>
                        Row {issue.rowIndex + 1}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
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
          {assistantInsights && (
            <div className="rounded border border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-600">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Import assistant summary</p>
              <p className="mt-1">
                {mappingSuggestionEntries.length > 0
                  ? `Passing ${mappingSuggestionEntries.length} mapping suggestion${mappingSuggestionEntries.length === 1 ? '' : 's'}`
                  : 'No mapping suggestions applied.'}
              </p>
              <p>
                {rowIssues.length > 0
                  ? `Assistant flagged ${rowIssues.length} sample row${rowIssues.length === 1 ? '' : 's'} for review.`
                  : 'No sample rows were flagged.'}
              </p>
              {hasStandardizedRows && <p>AI-standardized values are included for preview and downstream cleanup.</p>}
            </div>
          )}
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
