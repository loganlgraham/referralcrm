'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';

import { useFollowUpTaskContext } from '@/components/referrals/follow-up-task-provider';
import {
  buildAgentOnboardingTasks,
  type AgentOnboardingTask,
} from '@/components/agents/use-agent-onboarding-tasks';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

interface BoardAgent {
  _id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface AgentOnboardingTaskBoardProps {
  agents: BoardAgent[];
}

const formatDueDate = (value: string): string => {
  try {
    return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
  } catch (error) {
    return new Date(value).toLocaleString();
  }
};

export function AgentOnboardingTaskBoard({ agents }: AgentOnboardingTaskBoardProps) {
  const { completions, agentTasks, toggleTask, removeAgentTask } = useFollowUpTaskContext();

  const tasksByAgent = useMemo(() => {
    return agents.reduce<Record<string, AgentOnboardingTask[]>>((acc, agent) => {
      const tasks = buildAgentOnboardingTasks(agent._id, {
        completions,
        agentTasks,
        toggleTask,
        removeAgentTask,
        agentName: agent.name,
      });
      acc[agent._id] = tasks;
      return acc;
    }, {});
  }, [completions, agentTasks, agents, toggleTask, removeAgentTask]);

  const outstandingTasks = useMemo(
    () => Object.values(tasksByAgent).flat().filter((task) => !task.completed),
    [tasksByAgent]
  );

  const summary = useMemo(() => {
    return Object.values(tasksByAgent).reduce(
      (acc, tasks) => {
        const outstanding = tasks.filter((task) => !task.completed).length;
        return {
          total: acc.total + tasks.length,
          outstanding: acc.outstanding + outstanding,
        };
      },
      { total: 0, outstanding: 0 }
    );
  }, [tasksByAgent]);

  // Filter agents that have tasks
  const agentsWithTasks = useMemo(
    () => agents.filter((agent) => (tasksByAgent[agent._id] ?? []).length > 0),
    [agents, tasksByAgent]
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Agent onboarding tasks</h1>
        <p className="text-sm text-slate-500">
          Track onboarding tasks for newly added agents. Complete tasks as you finish each step.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-full bg-slate-900/10 px-3 py-1 font-semibold text-slate-800">
            {summary.outstanding} outstanding
          </span>
          <span className="rounded-full bg-slate-200 px-3 py-1 font-medium text-slate-600">
            {summary.total} total tasks
          </span>
        </div>
      </header>
      <div className="space-y-5">
        {agentsWithTasks.length > 0 ? (
          agentsWithTasks.map((agent) => (
            <AgentOnboardingTaskGroup
              key={agent._id}
              agent={agent}
              tasks={tasksByAgent[agent._id] ?? []}
            />
          ))
        ) : (
          <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
            No agent onboarding tasks at this time. Tasks will appear here when new agents are added.
          </div>
        )}
      </div>
    </div>
  );
}

function AgentOnboardingTaskGroup({
  agent,
  tasks,
}: {
  agent: BoardAgent;
  tasks: AgentOnboardingTask[];
}) {
  const incompleteTasks = useMemo(
    () => tasks.filter((task) => !task.completed),
    [tasks]
  );
  const completedTasks = useMemo(
    () => tasks.filter((task) => task.completed),
    [tasks]
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const outstanding = incompleteTasks.length;

  return (
    <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New Agent</p>
          <Link
            href={`/agents/${agent._id}`}
            className="text-lg font-semibold text-slate-900 underline-offset-2 hover:underline"
          >
            {agent.name}
          </Link>
          <p className="text-xs text-slate-500">{agent.email}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold text-slate-600">
            {outstanding} open task{outstanding === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin onboarding tasks</p>
      {tasks.length > 0 ? (
        <>
          {incompleteTasks.length > 0 ? (
            <ul className="space-y-3">
              {incompleteTasks.map((task) => (
                <li key={task.taskId} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <button
                    type="button"
                    onClick={task.toggle}
                    className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:bg-slate-100"
                    aria-pressed={task.completed}
                    aria-label={task.completed ? 'Mark task incomplete' : 'Mark task complete'}
                  >
                    {task.completed ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                  </button>
                  <div className="space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{task.title}</p>
                      <span className="text-xs uppercase tracking-wide text-slate-400">{task.category}</span>
                      <span className="text-xs font-semibold uppercase text-slate-400">{task.priority}</span>
                    </div>
                    <p className="text-sm text-slate-600">{task.message}</p>
                    {task.dueAt && (
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span>Due {formatDueDate(task.dueAt)}</span>
                      </div>
                    )}
                    {task.remove && (
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={task.remove}
                          className="inline-flex items-center rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                        >
                          Remove task
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
              All onboarding tasks completed for this agent.
            </div>
          )}
          {completedTasks.length > 0 && (
            <div className="border-t border-slate-200 pt-3 text-xs text-slate-600">
              <button
                type="button"
                className="font-semibold text-slate-700 underline underline-offset-4"
                onClick={() => setShowCompleted((previous) => !previous)}
              >
                {showCompleted
                  ? 'Hide completed tasks'
                  : `Show ${completedTasks.length} completed ${completedTasks.length === 1 ? 'task' : 'tasks'}`}
              </button>
              {showCompleted && (
                <ul className="mt-3 space-y-3">
                  {completedTasks.map((task) => (
                    <li key={task.taskId} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <button
                        type="button"
                        onClick={task.toggle}
                        className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-500 text-slate-700 transition hover:bg-slate-100"
                        aria-pressed={task.completed}
                        aria-label="Mark task incomplete"
                      >
                        <CheckCircle2 className="h-5 w-5" />
                      </button>
                      <div className="space-y-1 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900 line-through">{task.title}</p>
                          <span className="text-xs uppercase tracking-wide text-slate-400">{task.category}</span>
                        </div>
                        <p className="text-sm text-slate-600">{task.message}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <span className="font-medium uppercase text-slate-400">{task.priority}</span>
                          {task.dueAt && <span>Due {formatDueDate(task.dueAt)}</span>}
                        </div>
                        {task.remove && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={task.remove}
                              className="inline-flex items-center rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                            >
                              Remove task
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
          No onboarding tasks for this agent.
        </div>
      )}
    </section>
  );
}
