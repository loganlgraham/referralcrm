import { toast } from 'sonner';

interface PromptInactiveMetricsChoiceOptions {
  // Plain-language label for the person, e.g. 'agent' or 'mortgage consultant'.
  label: string;
  // Called with the admin's choice once they pick an option in the toast.
  // Dismissing the toast cancels the whole action and calls nothing.
  onChoose: (includeInMetrics: boolean) => void;
}

export function promptInactiveMetricsChoice({ label, onChoose }: PromptInactiveMetricsChoiceOptions): void {
  toast.custom(
    (id) => (
      <div className="w-[356px] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface-raised p-4 shadow-raised">
        <p className="text-sm font-medium text-foreground">Mark this {label} inactive</p>
        <p className="mt-1 text-xs text-foreground-muted">
          Should they still count in dashboard leaderboards?
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              toast.dismiss(id);
              onChoose(true);
            }}
            className="rounded-md bg-surface-muted px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-surface-subtle"
          >
            Keep in leaderboards
          </button>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(id);
              onChoose(false);
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-hover"
          >
            Exclude from leaderboards
          </button>
        </div>
      </div>
    ),
    { duration: 15000 }
  );
}
