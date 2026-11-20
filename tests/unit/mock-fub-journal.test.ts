import {
  createMockFubSteps,
  nextRunnableMockFubStep,
  summarizeMockFubSteps,
} from '@/lib/fub/mock-fub-journal';
import type { MockFubStepRecord } from '@/models/mock-fub';

function withStatuses(
  statuses: MockFubStepRecord['status'][],
): MockFubStepRecord[] {
  return createMockFubSteps('run-1', 'ref-1').map((step, index) => ({
    ...step,
    status: statuses[index] ?? step.status,
  }));
}

describe('mock FUB step journal', () => {
  it('creates deterministic operation keys for each independent step', () => {
    const first = createMockFubSteps('run-1', 'ref-1');
    const second = createMockFubSteps('run-1', 'ref-1');

    expect(first.map((step) => step.operationKey)).toEqual(
      second.map((step) => step.operationKey),
    );
    expect(new Set(first.map((step) => step.operationKey)).size).toBe(4);
  });

  it('runs only the first unfinished step and skips completed work on retry', () => {
    const steps = withStatuses(['succeeded', 'failed', 'pending', 'pending']);
    expect(nextRunnableMockFubStep(steps)?.name).toBe('assign_agent');
    expect(summarizeMockFubSteps(steps)).toBe('partial_failure');
  });

  it('blocks every resend after an ambiguous outcome', () => {
    const steps = withStatuses(['succeeded', 'ambiguous', 'pending', 'pending']);
    expect(nextRunnableMockFubStep(steps)).toBeNull();
    expect(summarizeMockFubSteps(steps)).toBe('ambiguous');
  });

  it('reports success only after every step completed', () => {
    expect(
      summarizeMockFubSteps(
        withStatuses(['succeeded', 'succeeded', 'succeeded', 'succeeded']),
      ),
    ).toBe('success');
  });
});
