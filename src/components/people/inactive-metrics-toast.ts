import { toast } from 'sonner';

interface PromptInactiveMetricsChoiceOptions {
  // Plain-language label for the person, e.g. 'agent' or 'mortgage consultant'.
  label: string;
  // Called with the admin's choice once they pick an option in the toast.
  // Dismissing the toast cancels the whole action and calls nothing.
  onChoose: (includeInMetrics: boolean) => void;
}

export function promptInactiveMetricsChoice({ label, onChoose }: PromptInactiveMetricsChoiceOptions): void {
  toast(`Mark this ${label} inactive — should they still count in dashboard leaderboards?`, {
    duration: 15000,
    cancel: {
      label: 'Keep in leaderboards',
      onClick: () => onChoose(true),
    },
    action: {
      label: 'Exclude from leaderboards',
      onClick: () => onChoose(false),
    },
  });
}
