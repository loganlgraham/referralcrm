import { test, expect } from '@playwright/test';

import { loginAs, type E2ERole } from './auth';

const ROLE_CASES: Array<{
  role: E2ERole;
  title: string;
  visible: string;
  hidden: string;
}> = [
  {
    role: 'admin',
    title: 'admin can sign in',
    visible: 'Dashboard',
    hidden: 'My Profile'
  },
  {
    role: 'aha-agent',
    title: 'AHA agent can sign in',
    visible: 'Find Referral Agent',
    hidden: 'Dashboard'
  },
  {
    role: 'oos-agent',
    title: 'OOS agent can sign in',
    visible: 'Find Referral Agent',
    hidden: 'Dashboard'
  },
  {
    role: 'mc',
    title: 'MC can sign in',
    visible: 'My Profile',
    hidden: 'Dashboard'
  }
];

test.describe('Role logins', () => {
  for (const { role, title, visible, hidden } of ROLE_CASES) {
    test(title, async ({ page }) => {
      await loginAs(page, role);
      await expect(page.getByRole('link', { name: visible })).toBeVisible();
      await expect(page.getByRole('link', { name: hidden })).toHaveCount(0);
    });
  }
});
