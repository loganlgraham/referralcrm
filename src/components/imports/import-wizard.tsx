'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { toast } from 'sonner';
import { IMPORT_ENTITY_CONFIG, IMPORT_ENTITY_NAMES, type ImportEntity } from '@/constants/imports';
import { Button } from '@/components/ui/button';
import { FieldFootnote, FieldGroup, FieldLabel, selectFieldClasses } from '@/components/ui/field-group';
import { PageHeader } from '@/components/ui/page-header';
import { TBody, THead, Table, TableScroll, TableShell, Td, Th, Tr } from '@/components/ui/table-shell';
import { cn } from '@/lib/cn';

const steps = ['Upload', 'Map Fields', 'Preview', 'Confirm'] as const;

type ImportAssistantInsights = {
  mappingSuggestions?: Record<string, string>;
  rowIssues?: { rowIndex: number; message: string }[];
  standardizedRows?: Record<string, string>[];
  notes?: string[];
};

type RowIssue = { rowIndex: number; message: string };

/**
 * Numbered stations, because an import genuinely is a sequence and the order is
 * information the operator needs. The signal node marks the current station.
 */
function StepRail({ activeIndex }: { activeIndex: number }) {
  return (
    <ol className="scrollbar-thin inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-pill border border-border bg-surface-raised p-1 shadow-card">
      {steps.map((item, index) => {
        const isCurrent = index === activeIndex;
        const isDone = index < activeIndex;
        return (
          <li key={item} className="flex shrink-0 items-center gap-1">
            {index > 0 ? (
              <span
                aria-hidden
                className={cn('h-[2px] w-5 rounded-full', isDone || isCurrent ? 'bg-primary' : 'bg-border')}
              />
            ) : null}
            <span
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-pill px-3 py-1.5 text-sm font-medium',
                isCurrent ? 'bg-primary text-white shadow-sm' : isDone ? 'text-foreground' : 'text-foreground-subtle'
              )}
            >
              <span
                className={cn(
                  'text-numeric inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                  isCurrent
                    ? 'bg-signal text-white'
                    : isDone
                      ? 'bg-primary text-white'
                      : 'bg-surface-muted text-foreground-subtle'
                )}
              >
                {index + 1}
              </span>
              {item}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FlaggedRows({ issues, keyPrefix = 'map' }: { issues: RowIssue[]; keyPrefix?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-eyebrow flex items-center gap-1.5 text-foreground-subtle">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal" />
        Flagged rows
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-foreground-muted">
        {issues.map((issue) => (
          <li key={`${keyPrefix}-${issue.rowIndex}-${issue.message}`}>
            Row <span className="text-numeric">{issue.rowIndex + 1}</span>: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportWizard() {
  const [step, setStep] = useState<typeof steps[number]>('Upload');
  const [entity, setEntity] = useState<ImportEntity>('Referral');
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

  const entityFields = (IMPORT_ENTITY_CONFIG[entity]?.fields ?? []) as readonly string[];
  const entityDescription = IMPORT_ENTITY_CONFIG[entity]?.description;

  const handleApplyMappingSuggestions = () => {
    if (!assistantInsights?.mappingSuggestions) return;
    setMapping((previous) => {
      const next = { ...previous };
      Object.entries(assistantInsights.mappingSuggestions ?? {}).forEach(([column, field]) => {
        if (entityFields.includes(field)) {
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

  const activeStepIndex = steps.indexOf(step);
  const mappedColumnCount = headers.filter((header) => Boolean(mapping[header])).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Data"
        title="Import wizard"
        description="Upload a CSV, XLSX, or ZIP file and map its columns to CRM fields."
        attention={false}
      />

      <StepRail activeIndex={activeStepIndex} />

      {step === 'Upload' && (
        <FieldGroup title="Upload" description="Pick what these rows represent, then choose a file.">
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <FieldLabel label="Entity" />
              <select
                className={cn(selectFieldClasses, 'sm:max-w-xs')}
                value={entity}
                onChange={(event) => setEntity(event.target.value as ImportEntity)}
              >
                {IMPORT_ENTITY_NAMES.map((key) => (
                  <option key={key}>{key}</option>
                ))}
              </select>
              <FieldFootnote reserve>{entityDescription}</FieldFootnote>
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.zip"
              onChange={handleFileChange}
              className="block w-full cursor-pointer rounded-lg border border-dashed border-border-strong/70 bg-surface px-4 py-6 text-sm text-foreground-muted transition hover:border-ring file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:font-display file:text-sm file:font-medium file:text-white"
            />
          </div>
        </FieldGroup>
      )}

      {step === 'Map Fields' && (
        <div className="space-y-5">
          <FieldGroup
            title="Map fields"
            description="Match each column in your file to a CRM field. Anything left on Ignore is skipped."
            action={
              <span className="text-xs text-foreground-subtle">
                <span className="text-numeric">{mappedColumnCount}</span> of{' '}
                <span className="text-numeric">{headers.length}</span> mapped
              </span>
            }
          >
            <div className="space-y-2">
              {headers.map((header) => (
                <div
                  key={header}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-sm font-medium text-foreground">{header}</span>
                  <select
                    value={mapping[header] ?? ''}
                    onChange={(event) => handleMappingChange(header, event.target.value)}
                    className={cn(selectFieldClasses, 'h-8 w-auto min-w-[12rem] text-xs')}
                  >
                    <option value="">Ignore</option>
                    {entityFields.map((field) => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup
            title="Import assistant"
            description="Suggestions to speed up mapping and flag messy data before it lands."
            action={
              <Button variant="secondary" size="sm" loading={assistantLoading} onClick={() => void fetchAssistantInsights()}>
                {assistantLoading ? 'Analyzing…' : 'Refresh'}
              </Button>
            }
          >
            <div className="space-y-3 text-sm text-foreground-muted">
              {assistantLoading && <p className="text-foreground-subtle">Analyzing sample rows…</p>}
              {!assistantLoading && assistantError && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
                  <span className="text-sm text-danger">{assistantError}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => void fetchAssistantInsights()}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {!assistantLoading && !assistantError && (
                <>
                  {mappingSuggestionEntries.length > 0 ? (
                    <div>
                      <p className="text-eyebrow text-foreground-subtle">Suggested matches</p>
                      <ul className="mt-2 space-y-1 text-xs">
                        {mappingSuggestionEntries.map(([column, field]) => (
                          <li
                            key={column}
                            className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-2.5 py-1.5"
                          >
                            <span className="font-medium text-foreground">{column}</span>
                            <span className="text-foreground-subtle">→ {field}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-foreground-subtle">No mapping suggestions yet.</p>
                  )}
                  {assistantNotes.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-eyebrow text-foreground-subtle">Assistant notes</p>
                      <ul className="list-disc space-y-1 pl-5 text-xs text-foreground-muted">
                        {assistantNotes.map((note, index) => (
                          <li key={`${note}-${index}`}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {rowIssues.length > 0 && <FlaggedRows issues={rowIssues} />}
                </>
              )}
            </div>
            <div className="mt-4">
              <Button
                onClick={handleApplyMappingSuggestions}
                disabled={assistantLoading || mappingSuggestionEntries.length === 0}
              >
                Apply suggestions
              </Button>
            </div>
          </FieldGroup>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setStep('Upload')}>
              Back
            </Button>
            <Button onClick={() => setStep('Preview')}>Continue</Button>
          </div>
        </div>
      )}

      {step === 'Preview' && (
        <div className="space-y-5">
          <FieldGroup
            title="Preview"
            description="The first 20 rows, exactly as they will be read."
            action={
              hasStandardizedRows ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
                    checked={useStandardizedPreview}
                    onChange={(event) => setUseStandardizedPreview(event.target.checked)}
                  />
                  Use cleaned preview
                </label>
              ) : null
            }
          >
            <TableShell className="shadow-none">
              <TableScroll className="max-h-64 overflow-y-auto">
                <Table>
                  <THead>
                    <Tr>
                      {headers.map((header) => (
                        <Th key={header} dense>
                          {header}
                        </Th>
                      ))}
                    </Tr>
                  </THead>
                  <TBody>
                    {previewRows.map((row, index) => (
                      <Tr key={index}>
                        {headers.map((header) => (
                          <Td key={header} dense>
                            {row[header]}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            </TableShell>
          </FieldGroup>

          {(rowIssues.length > 0 || assistantNotes.length > 0) && (
            <FieldGroup title="Before you continue">
              <div className="space-y-3 text-xs text-foreground-muted">
                {assistantNotes.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-eyebrow text-foreground-subtle">Assistant notes</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {assistantNotes.map((note, index) => (
                        <li key={`preview-note-${index}`}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {rowIssues.length > 0 && <FlaggedRows issues={rowIssues} keyPrefix="preview" />}
              </div>
            </FieldGroup>
          )}

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setStep('Map Fields')}>
              Back
            </Button>
            <Button onClick={() => setStep('Confirm')}>Continue</Button>
          </div>
        </div>
      )}

      {step === 'Confirm' && (
        <div className="space-y-5">
          <FieldGroup title="Confirm" description="This is the mapping that will be applied to every row in the file.">
            <pre className="text-numeric max-h-40 overflow-auto rounded-lg bg-primary p-4 text-xs leading-5 text-white">
              {JSON.stringify(mapping, null, 2)}
            </pre>
            {assistantInsights && (
              <div className="mt-3 rounded-lg bg-surface-muted p-4 text-xs text-foreground-muted">
                <p className="text-eyebrow text-foreground-subtle">Assistant summary</p>
                <p className="mt-2">
                  {mappingSuggestionEntries.length > 0
                    ? `Passing ${mappingSuggestionEntries.length} mapping suggestion${mappingSuggestionEntries.length === 1 ? '' : 's'}.`
                    : 'No mapping suggestions applied.'}
                </p>
                <p>
                  {rowIssues.length > 0 ? (
                    <span className="font-medium text-signal">
                      {rowIssues.length} sample row{rowIssues.length === 1 ? '' : 's'} flagged for review.
                    </span>
                  ) : (
                    'No sample rows were flagged.'
                  )}
                </p>
                {hasStandardizedRows && <p>Cleaned values are included for preview and downstream cleanup.</p>}
              </div>
            )}
          </FieldGroup>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setStep('Preview')}>
              Back
            </Button>
            <Button onClick={handleConfirm}>Start import</Button>
          </div>
        </div>
      )}
    </div>
  );
}
