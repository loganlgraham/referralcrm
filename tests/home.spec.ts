import { test, expect } from '@playwright/test';

test('the app loads without crashing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
