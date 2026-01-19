import React from 'react';
import { render, screen } from '@testing-library/react';
import { jest } from '@jest/globals';

import { FollowUpTasksBoard } from '@/components/referrals/follow-up-task-board';
import { type FollowUpTaskRole } from '@/components/referrals/use-follow-up-tasks';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('@/components/referrals/follow-up-task-provider', () => ({
  useFollowUpTaskContext: () => ({
    completions: {},
    manualTasks: {},
    shownTasks: {},
    taskMetadata: {},
    toggleTask: jest.fn(),
    removeManualTask: jest.fn(),
    markTasksAsShown: jest.fn(),
    storeTaskMetadata: jest.fn(),
  }),
}));

jest.mock('@/components/referrals/use-follow-up-tasks', () => ({
  buildFollowUpTasksForReferral: jest.fn(() => []),
}));

jest.mock('@/components/referrals/use-task-reminder-emails', () => ({
  useTaskReminderEmails: () => ({
    sendReminders: jest.fn(),
    bulkSending: false,
    sendingTaskId: null,
    reminderFrequency: 'weekly',
    reminderEnabled: false,
  }),
}));

jest.mock('@/components/referrals/reminder-settings-toggle', () => ({
  ReminderSettingsToggle: () => <div data-testid="reminder-toggle" />,
}));

describe('FollowUpTasksBoard status labels', () => {
  const viewerRole: FollowUpTaskRole = 'admin';
  const baseReferral = {
    _id: '1',
    borrowerName: 'Alice Johnson',
    status: 'Active Lead',
    createdAt: new Date().toISOString(),
    statusLastUpdated: null,
    daysInStatus: 2,
    assignedAgentName: 'Jordan Agent',
    buySideAgentName: null,
    sellSideAgentName: null,
    clientType: 'Buyer' as const,
    dealSide: 'buy' as const,
    lenderName: null,
    origin: 'agent' as const,
    dealStatus: null,
    dealStatusLabel: null,
  };

  it('shows the referral status before reaching Under Contract', () => {
    render(<FollowUpTasksBoard referrals={[baseReferral]} viewerRole={viewerRole} />);

    expect(screen.getByText('Active Lead')).toBeInTheDocument();
  });

  it('shows the deal status label once the referral is under contract', () => {
    const underContractReferral = {
      ...baseReferral,
      _id: '2',
      status: 'Under Contract',
      dealStatus: 'past_inspection',
      dealStatusLabel: 'Past Inspection',
    };

    render(<FollowUpTasksBoard referrals={[underContractReferral]} viewerRole={viewerRole} />);

    expect(screen.getByText('Past Inspection')).toBeInTheDocument();
    expect(screen.queryByText('Under Contract')).not.toBeInTheDocument();
  });
});
