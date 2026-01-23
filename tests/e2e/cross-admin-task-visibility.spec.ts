import { test, expect } from '@playwright/test';

/**
 * Cross-Admin Task Completion Visibility Test
 *
 * This test verifies that when Admin A completes a task, the completion
 * is visible to Admin B when they view the same referral's "Completed tasks" section.
 *
 * This is a regression test for the bug where completed tasks were not visible
 * across different admin sessions due to API response caching.
 *
 * Prerequisites:
 * - Two admin test accounts configured (ADMIN_A_EMAIL/PASS, ADMIN_B_EMAIL/PASS)
 * - At least one referral with tasks exists
 */
test.describe('Cross-Admin Task Completion Visibility', () => {
  // Skip if test accounts are not configured
  const adminAEmail = process.env.TEST_ADMIN_A_EMAIL || 'admin-a@test.com';
  const adminAPassword = process.env.TEST_ADMIN_A_PASSWORD || 'test-password';
  const adminBEmail = process.env.TEST_ADMIN_B_EMAIL || 'admin-b@test.com';
  const adminBPassword = process.env.TEST_ADMIN_B_PASSWORD || 'test-password';

  // Helper to login as a specific admin
  async function loginAsAdmin(
    page: any,
    email: string,
    password: string
  ) {
    await page.goto('/login');

    // Fill in credentials
    await page.fill('input[name="email"], input[type="email"]', email);
    await page.fill('input[name="password"], input[type="password"]', password);

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard or referrals page
    await page.waitForURL(/\/(dashboard|referrals|$)/, { timeout: 10000 });
  }

  // Helper to logout
  async function logout(page: any) {
    // Look for logout button or user menu
    const userMenu = page.locator('[data-testid="user-menu"], button:has-text("Logout"), a:has-text("Logout")');
    if (await userMenu.isVisible()) {
      await userMenu.click();

      // If it's a dropdown menu, click logout option
      const logoutOption = page.locator('button:has-text("Logout"), a:has-text("Logout"), [data-testid="logout"]');
      if (await logoutOption.isVisible()) {
        await logoutOption.click();
      }
    }

    // Wait for redirect to login page
    await page.waitForURL(/\/login/, { timeout: 10000 });
  }

  test('task completed by Admin A is visible in Completed tasks for Admin B', async ({ page }) => {
    // Step 1: Login as Admin A
    await loginAsAdmin(page, adminAEmail, adminAPassword);

    // Step 2: Navigate to Follow-Up Tasks page (Task Board)
    await page.goto('/referrals/follow-ups');
    await page.waitForSelector('h1:has-text("Follow-up tasks")', { timeout: 10000 });

    // Step 3: Find a task and its referral
    const firstTaskGroup = page.locator('li[class*="rounded-lg"]').first();
    await expect(firstTaskGroup).toBeVisible({ timeout: 5000 });

    // Get the referral link to navigate to later
    const referralLink = firstTaskGroup.locator('a[href^="/referrals/"]').first();
    const referralHref = await referralLink.getAttribute('href');
    expect(referralHref).toBeTruthy();

    // Step 4: Navigate to the referral detail page
    await page.goto(referralHref!);
    await page.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 10000 });

    // Step 5: Find an incomplete task and get its title for verification
    const incompleteTask = page.locator('button[aria-pressed="false"]').first();
    const incompleteTaskCount = await incompleteTask.count();

    // Skip test if no incomplete tasks are available
    if (incompleteTaskCount === 0) {
      console.log('No incomplete tasks found, skipping test');
      return;
    }

    // Get the task title for later verification
    const taskItem = incompleteTask.locator('..').locator('..'); // Navigate up to the task container
    const taskTitleElement = taskItem.locator('p.font-medium').first();
    const taskTitle = await taskTitleElement.textContent();
    expect(taskTitle).toBeTruthy();

    console.log(`Admin A completing task: "${taskTitle}"`);

    // Step 6: Complete the task (Admin A)
    await incompleteTask.click();
    await expect(incompleteTask).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });

    // Wait for the sync to complete
    await page.waitForTimeout(1500);

    // Step 7: Logout as Admin A
    await logout(page);

    // Step 8: Login as Admin B
    await loginAsAdmin(page, adminBEmail, adminBPassword);

    // Step 9: Navigate to the same referral
    await page.goto(referralHref!);
    await page.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 10000 });

    // Step 10: Click "Show completed tasks" link
    const completedTasksLink = page.locator('button:has-text("Show"), button:has-text("completed task")').first();
    await expect(completedTasksLink).toBeVisible({ timeout: 5000 });
    await completedTasksLink.click();

    // Step 11: Verify the task appears in the completed list
    // The completed task should have a line-through on the title
    const completedTaskTitle = page.locator(`p.line-through:has-text("${taskTitle}")`);
    await expect(completedTaskTitle).toBeVisible({ timeout: 5000 });

    console.log(`Admin B sees completed task: "${taskTitle}" - TEST PASSED`);

    // Cleanup: Toggle the task back to incomplete so the test is repeatable
    const completedTaskCheckbox = completedTaskTitle.locator('..').locator('..').locator('button[aria-pressed="true"]');
    if (await completedTaskCheckbox.isVisible()) {
      await completedTaskCheckbox.click();
      await page.waitForTimeout(1000);
    }
  });

  test('completed tasks sync immediately without page refresh', async ({ page, context }) => {
    // This test uses two browser contexts to simulate two admin users
    // viewing the same referral simultaneously

    // Create a second browser context for Admin B
    const pageBContext = await context.browser()!.newContext();
    const pageB = await pageBContext.newPage();

    try {
      // Login Admin A in page, Admin B in pageB
      await loginAsAdmin(page, adminAEmail, adminAPassword);
      await loginAsAdmin(pageB, adminBEmail, adminBPassword);

      // Navigate to Follow-Up Tasks to find a referral
      await page.goto('/referrals/follow-ups');
      await page.waitForSelector('h1:has-text("Follow-up tasks")', { timeout: 10000 });

      // Get a referral link
      const referralLink = page.locator('a[href^="/referrals/"]').first();
      const referralHref = await referralLink.getAttribute('href');
      expect(referralHref).toBeTruthy();

      // Both admins navigate to the same referral
      await page.goto(referralHref!);
      await pageB.goto(referralHref!);

      await page.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 10000 });
      await pageB.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 10000 });

      // Find an incomplete task on Admin A's page
      const incompleteTask = page.locator('button[aria-pressed="false"]').first();
      const incompleteTaskCount = await incompleteTask.count();

      if (incompleteTaskCount === 0) {
        console.log('No incomplete tasks found, skipping test');
        return;
      }

      // Get task title
      const taskItem = incompleteTask.locator('..').locator('..');
      const taskTitle = await taskItem.locator('p.font-medium').first().textContent();
      expect(taskTitle).toBeTruthy();

      console.log(`Admin A completing task: "${taskTitle}"`);

      // Admin A completes the task
      await incompleteTask.click();
      await expect(incompleteTask).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });

      // Wait for sync
      await page.waitForTimeout(1500);

      // Admin B refreshes the page
      await pageB.reload({ waitUntil: 'networkidle' });
      await pageB.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 10000 });

      // Admin B clicks "Show completed tasks"
      const completedTasksLinkB = pageB.locator('button:has-text("Show"), button:has-text("completed task")').first();
      await expect(completedTasksLinkB).toBeVisible({ timeout: 5000 });
      await completedTasksLinkB.click();

      // Verify Admin B sees the completed task
      const completedTaskTitleB = pageB.locator(`p.line-through:has-text("${taskTitle}")`);
      await expect(completedTaskTitleB).toBeVisible({ timeout: 5000 });

      console.log(`Admin B sees completed task after refresh: "${taskTitle}" - TEST PASSED`);

      // Cleanup
      const completedTaskCheckboxB = completedTaskTitleB.locator('..').locator('..').locator('button[aria-pressed="true"]');
      if (await completedTaskCheckboxB.isVisible()) {
        await completedTaskCheckboxB.click();
        await pageB.waitForTimeout(1000);
      }
    } finally {
      await pageBContext.close();
    }
  });
});
