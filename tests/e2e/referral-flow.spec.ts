import { test, expect } from '@playwright/test';

test.describe('Referral workflow', () => {
  test('mark paid collects amount from toast on referral page', async ({ page }) => {
    const identifier = process.env.E2E_LOGIN_IDENTIFIER;
    const password = process.env.E2E_LOGIN_PASSWORD;

    test.skip(!identifier || !password, 'Set E2E_LOGIN_IDENTIFIER and E2E_LOGIN_PASSWORD');

    const stamp = Date.now();
    const borrowerEmail = `e2e.mark-paid.${stamp}@example.com`;
    const expectedAmount = '1234.56';
    const paidAmount = '1200.50';

    // 1) Login
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Username or email').fill(identifier!);
    await page.getByLabel('Password').fill(password!);
    const credentialsCallback = page.waitForResponse((response) =>
      response.url().includes('/api/auth/callback/credentials')
    );
    await page.getByRole('button', { name: 'Sign in' }).click();
    await credentialsCallback;
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });

    // 2) Create referral
    await page.goto('/referrals/new');
    await expect(page.getByRole('heading', { name: 'Start a new referral' })).toBeVisible();
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill(`MarkPaid${stamp}`);
    await page.getByLabel('Email').fill(borrowerEmail);
    await page.getByLabel('Phone').fill('555-123-4567');
    await page.getByLabel('Looking in (ZIP)').fill('80202');
    await page.getByLabel('Borrower current address').fill('123 Test St, Denver, CO 80202');

    const source = page.getByLabel('Source');
    if (await source.count()) await source.fill('E2E Test Source');
    const endorser = page.getByLabel('Endorser');
    if (await endorser.count()) await endorser.fill('E2E Endorser');
    const loanFile = page.getByLabel('Loan file number');
    if (await loanFile.count()) await loanFile.fill(`E2E-MARK-PAID-${stamp}`);

    await page.getByRole('button', { name: /Create referral|Creating…/ }).click();
    await expect(page).toHaveURL(/\/referrals\/.+/);

    // 3) Add a deal with expected amount so Mark Paid has a default
    await page.getByRole('button', { name: 'Add deal' }).click();
    await page.getByLabel('Expected amount').fill(expectedAmount);
    await page.locator('form').filter({ has: page.getByRole('button', { name: 'Add deal' }) }).getByRole('button', { name: 'Add deal' }).click();
    await expect(page.getByText('Deal added')).toBeVisible();

    // 4) Click Mark Paid, verify toast prefill, submit custom paid amount
    await page.getByRole('button', { name: 'Mark Paid' }).first().click();
    await expect(page.getByText('Mark deal as paid')).toBeVisible();
    const markPaidToast = page.locator('form').filter({
      has: page.getByText('Mark deal as paid'),
    });
    const paidInput = markPaidToast.getByLabel('Amount paid');
    await expect(paidInput).toHaveValue(expectedAmount);
    await paidInput.fill(paidAmount);
    await markPaidToast.getByRole('button', { name: 'Save', exact: true }).click();

    // 5) Verify save completed and amount persisted on referral deal card
    await expect(page.getByText('Deal stage updated')).toBeVisible();
    await expect(page.getByText('Net paid: $1,200.50')).toBeVisible();
  });

  test('agent deal form does not allow side switching', async ({ page }) => {
    const identifier = process.env.E2E_LOGIN_IDENTIFIER;
    const password = process.env.E2E_LOGIN_PASSWORD;

    test.skip(!identifier || !password, 'Set E2E_LOGIN_IDENTIFIER and E2E_LOGIN_PASSWORD');

    const stamp = Date.now();
    const borrowerEmail = `e2e.sell-side.${stamp}@example.com`;

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Username or email').fill(identifier!);
    await page.getByLabel('Password').fill(password!);
    const credentialsCallback = page.waitForResponse((response) =>
      response.url().includes('/api/auth/callback/credentials')
    );
    await page.getByRole('button', { name: 'Sign in' }).click();
    await credentialsCallback;
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });

    await page.goto('/referrals/new');
    await expect(page.getByRole('heading', { name: 'Start a new referral' })).toBeVisible();
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill(`SellSide${stamp}`);
    await page.getByLabel('Email').fill(borrowerEmail);
    await page.getByLabel('Phone').fill('555-123-4567');
    await page.getByLabel('Looking in (ZIP)').fill('80202');
    await page.getByLabel('Borrower current address').fill('123 Test St, Denver, CO 80202');

    const clientType = page.getByLabel('Client type');
    if (await clientType.count()) {
      await clientType.selectOption('Seller');
    }

    await page.getByRole('button', { name: /Create referral|Creating…/ }).click();
    await expect(page).toHaveURL(/\/referrals\/.+/);

    await page.getByRole('button', { name: 'Add deal' }).click();
    await expect(page.getByLabel('Deal side')).toHaveCount(0);
    await expect(page.getByText('Used AFC')).toHaveCount(0);
  });
});
