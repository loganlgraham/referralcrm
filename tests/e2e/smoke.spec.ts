import { test, expect } from '@playwright/test';

test('unauthenticated visitors land on sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
