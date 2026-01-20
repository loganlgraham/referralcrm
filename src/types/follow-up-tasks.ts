import type { RecommendationPriority } from '@/utils/sla-insights';

export type ManualTaskCategory = 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';

export interface ManualTask {
  id: string;
  title: string;
  message: string;
  dueAt?: string | null;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
  createdAt: string;
}

export interface ManualTaskInput {
  title: string;
  message: string;
  dueAt?: string | null;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
}

export interface ManualTaskListResponse {
  tasks: ManualTask[];
}
