import { test, expect } from '@playwright/test';

test.describe('Referral flow', () => {
  test('login and create referral', async ({ page }) => {
    const identifier = process.env.E2E_LOGIN_IDENTIFIER;
    const password = process.env.E2E_LOGIN_PASSWORD;

    test.skip(!identifier || !password, 'Set E2E_LOGIN_IDENTIFIER and E2E_LOGIN_PASSWORD');

    // Unique borrower identity to avoid duplicate-email collisions.
    const stamp = Date.now();
    const borrowerEmail = `e2e.borrower.${stamp}@example.com`;

    // 1) Login
    await page.goto('/login');
    await page.getByLabel('Username or email').fill(identifier!);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait until authenticated page loads.
    await expect(page).toHaveURL(/\/dashboard/);

    // 2) Open new referral form
    await page.goto('/referrals/new');
    await expect(page.getByRole('heading', { name: 'Start a new referral' })).toBeVisible();

    // 3) Fill required base fields
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill(`Borrower${stamp}`);
    await page.getByLabel('Email').fill(borrowerEmail);
    await page.getByLabel('Phone').fill('555-123-4567');
    await page.getByLabel('Looking in (ZIP)').fill('80202');
    await page.getByLabel('Borrower current address').fill('123 Test St, Denver, CO 80202');

    // 4) Fill fields that appear for some roles (admin/MC) only
    const source = page.getByLabel('Source');
    if (await source.count()) await source.fill('E2E Test Source');

    const endorser = page.getByLabel('Endorser');
    if (await endorser.count()) await endorser.fill('E2E Endorser');

    const loanFile = page.getByLabel('Loan file number');
    if (await loanFile.count()) await loanFile.fill(`E2E-${stamp}`);

    const loanType = page.getByLabel('Loan type');
    if (await loanType.count()) await loanType.fill('Conventional');

    const preApproval = page.getByLabel('Pre-approval amount');
    if (await preApproval.count()) await preApproval.fill('300000');

    const notes = page.getByLabel('Notes for the team').locator('xpath=following::textarea[1]');
    if (await notes.count()) await notes.fill('Created by Playwright E2E test.');

    // 5) Submit
    await page.getByRole('button', { name: /Create referral|Creating…/ }).click();

    // 6) Assert redirect to a referral detail page
    await expect(page).toHaveURL(/\/referrals\/.+/);
    await expect(page).not.toHaveURL(/\/referrals\/new$/);
  });
});