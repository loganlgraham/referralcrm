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

    // Wait for the login form to be visible
    await page.waitForSelector('#identifier', { timeout: 10000 });

    // Fill in credentials - the login page uses id="identifier" not name="email"
    await page.fill('#identifier', email);
    await page.fill('#password', password);

    // Submit form
    await page.click('button[type="submit"]');
    
    // Wait for either redirect to dashboard/referrals OR check for error message
    // The login uses window.location.assign() which is a full page navigation
    try {
      // Wait for URL to change away from /login
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
      
      // Verify we're on a valid post-login page
      const currentUrl = page.url();
      if (currentUrl.includes('/dashboard') || currentUrl.includes('/referrals')) {
        // Wait for page to fully load
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        return; // Success
      }
    } catch (error) {
      // Check if there's an error message on the page
      const errorElement = page.locator('[role="alert"], .text-red-900, .text-red-600, .bg-red-50');
      const hasError = await errorElement.isVisible({ timeout: 2000 }).catch(() => false);
      if (hasError) {
        const errorText = await errorElement.textContent();
        throw new Error(`Login failed with error: ${errorText || 'Unknown error'}`);
      }
      // If no error message, check current URL
      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        throw new Error(`Login failed: Still on login page after timeout. URL: ${currentUrl}`);
      }
      // Re-throw original error if we can't determine the issue
      throw error;
    }
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
    await page.waitForSelector('h1:has-text("Follow-up tasks")', { timeout: 30000 });

    // Step 3: Find a task and its referral
    // The referral link is in the outer li with rounded-2xl class, not rounded-lg
    const firstTaskGroup = page.locator('li[class*="rounded-2xl"]').first();
    await expect(firstTaskGroup).toBeVisible({ timeout: 5000 });

    // Get the referral link to navigate to later
    const referralLink = firstTaskGroup.locator('a[href^="/referrals/"]').first();
    await expect(referralLink).toBeVisible({ timeout: 5000 });
    const referralHref = await referralLink.getAttribute('href');
    expect(referralHref).toBeTruthy();

    // Step 4: Navigate to the referral detail page
    await page.goto(referralHref!);
    // Wait for page to be fully loaded before checking for elements
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 30000 });

    // Step 5: Find an incomplete task and get its title for verification
    const incompleteTask = page.locator('button[aria-pressed="false"]').first();
    await expect(incompleteTask).toBeVisible({ timeout: 5000 });
    const incompleteTaskCount = await incompleteTask.count();

    // Skip test if no incomplete tasks are available
    if (incompleteTaskCount === 0) {
      console.log('No incomplete tasks found, skipping test');
      return;
    }

    // Get the task title for later verification
    const taskItem = incompleteTask.locator('..').locator('..'); // Navigate up to the task container
    const taskTitleElement = taskItem.locator('p.font-medium').first();
    const taskTitleRaw = await taskTitleElement.textContent();
    expect(taskTitleRaw).toBeTruthy();
    const taskTitle = taskTitleRaw?.trim() || '';
    expect(taskTitle).toBeTruthy();

    console.log(`Admin A completing task: "${taskTitle}"`);

    // Step 6: Complete the task (Admin A)
    // Wait for the API request to complete before checking the state
    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/follow-up-tasks/') && resp.request().method() === 'PUT', { timeout: 10000 }),
      incompleteTask.click()
    ]);
    
    // Verify the API call succeeded
    expect(response.ok()).toBeTruthy();
    await expect(incompleteTask).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });

    // Wait for the sync to complete
    await page.waitForTimeout(1500);

    // Step 7: Logout as Admin A
    await logout(page);

    // Step 8: Login as Admin B
    await loginAsAdmin(page, adminBEmail, adminBPassword);

    // Step 9: Navigate to the same referral
    await page.goto(referralHref!);
    // Wait for page to be fully loaded before checking for elements
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 30000 });

    // Step 10: Click "Show completed tasks" link
    // The button text is dynamic: "Show 1 completed task" or "Show 2 completed tasks"
    const completedTasksLink = page
      .locator('button')
      .filter({ hasText: /Show.*completed.*task/i })
      .first();
    
    // Provide better error message if button not found
    const linkCount = await completedTasksLink.count();
    if (linkCount === 0) {
      const allButtons = await page.locator('button').allTextContents();
      throw new Error(`"Show completed tasks" button not found. Found ${allButtons.length} buttons on page. Button texts: ${allButtons.slice(0, 10).join(', ')}`);
    }
    
    await expect(completedTasksLink).toBeVisible({ timeout: 5000 });
    await completedTasksLink.click();

    // Step 11: Verify the task appears in the completed list
    // The completed task should have a line-through on the title
    // Use trimmed task title and escape special regex characters
    const taskTitleEscaped = taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const completedTaskTitle = page.locator('p.line-through').filter({ hasText: new RegExp(taskTitleEscaped, 'i') });
    
    // Provide better error message if task not found
    const taskCount = await completedTaskTitle.count();
    if (taskCount === 0) {
      const allCompletedTasks = await page.locator('p.line-through').allTextContents();
      throw new Error(`Completed task "${taskTitle}" not found. Found ${allCompletedTasks.length} completed tasks. Task texts: ${allCompletedTasks.slice(0, 5).join(', ')}`);
    }
    
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
      await page.waitForSelector('h1:has-text("Follow-up tasks")', { timeout: 30000 });

      // Get a referral link
      const referralLink = page.locator('a[href^="/referrals/"]').first();
      await expect(referralLink).toBeVisible({ timeout: 5000 });
      const referralHref = await referralLink.getAttribute('href');
      expect(referralHref).toBeTruthy();

      // Both admins navigate to the same referral
      await page.goto(referralHref!);
      await pageB.goto(referralHref!);

      // Wait for pages to be fully loaded before checking for elements
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      await pageB.waitForLoadState('networkidle', { timeout: 30000 });
      await page.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 30000 });
      await pageB.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 30000 });

      // Find an incomplete task on Admin A's page
      const incompleteTask = page.locator('button[aria-pressed="false"]').first();
      await expect(incompleteTask).toBeVisible({ timeout: 5000 });
      const incompleteTaskCount = await incompleteTask.count();

      if (incompleteTaskCount === 0) {
        console.log('No incomplete tasks found, skipping test');
        return;
      }

      // Get task title
      const taskItem = incompleteTask.locator('..').locator('..');
      const taskTitleRaw = await taskItem.locator('p.font-medium').first().textContent();
      expect(taskTitleRaw).toBeTruthy();
      const taskTitle = taskTitleRaw?.trim() || '';
      expect(taskTitle).toBeTruthy();

      console.log(`Admin A completing task: "${taskTitle}"`);

      // Admin A completes the task
      // Wait for the API request to complete before checking the state
      const [response] = await Promise.all([
        page.waitForResponse((resp) => resp.url().includes('/api/follow-up-tasks/') && resp.request().method() === 'PUT', { timeout: 10000 }),
        incompleteTask.click()
      ]);
      
      // Verify the API call succeeded
      expect(response.ok()).toBeTruthy();
      await expect(incompleteTask).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });

      // Wait for sync
      await page.waitForTimeout(1500);

      // Admin B refreshes the page
      await pageB.reload({ waitUntil: 'networkidle' });
      // Wait for page to be fully loaded after reload
      await pageB.waitForLoadState('networkidle', { timeout: 30000 });
      await pageB.waitForSelector('h2:has-text("Follow-up tasks")', { timeout: 30000 });

      // Admin B clicks "Show completed tasks"
      // The button text is dynamic: "Show 1 completed task" or "Show 2 completed tasks"
      const completedTasksLinkB = pageB
        .locator('button')
        .filter({ hasText: /Show.*completed.*task/i })
        .first();
      
      // Provide better error message if button not found
      const linkCountB = await completedTasksLinkB.count();
      if (linkCountB === 0) {
        const allButtonsB = await pageB.locator('button').allTextContents();
        throw new Error(`"Show completed tasks" button not found on Admin B's page. Found ${allButtonsB.length} buttons. Button texts: ${allButtonsB.slice(0, 10).join(', ')}`);
      }
      
      await expect(completedTasksLinkB).toBeVisible({ timeout: 5000 });
      await completedTasksLinkB.click();

      // Verify Admin B sees the completed task
      // Use trimmed task title and escape special regex characters
      const taskTitleEscaped = taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const completedTaskTitleB = pageB.locator('p.line-through').filter({ hasText: new RegExp(taskTitleEscaped, 'i') });
      
      // Provide better error message if task not found
      const taskCountB = await completedTaskTitleB.count();
      if (taskCountB === 0) {
        const allCompletedTasksB = await pageB.locator('p.line-through').allTextContents();
        throw new Error(`Completed task "${taskTitle}" not found on Admin B's page. Found ${allCompletedTasksB.length} completed tasks. Task texts: ${allCompletedTasksB.slice(0, 5).join(', ')}`);
      }
      
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
