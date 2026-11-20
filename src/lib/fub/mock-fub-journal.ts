import {
  MOCK_FUB_STEP_NAMES,
  type MockFubAttemptStatus,
  type MockFubStepRecord,
} from '@/models/mock-fub';

export function createMockFubSteps(
  fixtureRunId: string,
  referralId: string,
): MockFubStepRecord[] {
  return MOCK_FUB_STEP_NAMES.map((name) => ({
    name,
    status: 'pending',
    attempts: 0,
    operationKey: `${fixtureRunId}:${referralId}:${name}`,
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    result: null,
  }));
}

export function summarizeMockFubSteps(
  steps: readonly MockFubStepRecord[],
): MockFubAttemptStatus {
  if (steps.some((step) => step.status === 'ambiguous')) return 'ambiguous';
  if (steps.some((step) => step.status === 'failed')) return 'partial_failure';
  if (
    steps.length === MOCK_FUB_STEP_NAMES.length &&
    steps.every((step) => step.status === 'succeeded' || step.status === 'skipped')
  ) {
    return 'success';
  }
  if (steps.some((step) => step.status === 'running')) return 'running';
  return 'pending';
}

export function nextRunnableMockFubStep(
  steps: readonly MockFubStepRecord[],
): MockFubStepRecord | null {
  if (steps.some((step) => step.status === 'ambiguous')) return null;
  return (
    steps.find(
      (step) =>
        step.status !== 'succeeded' &&
        step.status !== 'skipped',
    ) ?? null
  );
}
