import { test, expect } from '@playwright/test';

test.describe('Referral workflow', () => {
  test('placeholder flow', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Referral CRM/);
  });
});
