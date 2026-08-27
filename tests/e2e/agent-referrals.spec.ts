import { expect, test, type Locator, type Page } from '@playwright/test';

import { loginAs } from './auth';

function filterButton(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`^${label}`) });
}

async function waitForAgentReferralsPage(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'My referrals' }).or(page.getByText('No referrals yet'))
  ).toBeVisible();
}

async function isPageLevelEmpty(page: Page) {
  return page.getByText('No referrals yet').isVisible();
}

/** Switch off the default Needs-update filter when it has no rows. */
async function showRowsIfNeeded(page: Page) {
  const needsUpdateEmpty = page.getByText('Nothing needs you right now');
  if (await needsUpdateEmpty.isVisible()) {
    await filterButton(page, 'All').click();
  }
}

async function firstReferralRow(page: Page): Promise<Locator | null> {
  await showRowsIfNeeded(page);
  const addNote = page.getByRole('button', { name: 'Add note' }).first();
  if (!(await addNote.isVisible())) {
    return null;
  }
  return page.locator('div.rounded-card').filter({ has: addNote }).first();
}

test.describe('Agent referrals page', () => {
  test('shows agent list chrome after sign-in', async ({ page }) => {
    await loginAs(page, 'aha-agent');
    await waitForAgentReferralsPage(page);

    await expect(page).toHaveURL(/\/referrals\/?$/);
    await expect(page.getByRole('link', { name: 'Find Referral Agent' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
    await expect(page.getByText('Track every lead from intake through close.')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Introduce a client to AFC' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Introduce a client to AFC' }).first()).toHaveAttribute(
      'href',
      '/referrals/new'
    );

    if (await isPageLevelEmpty(page)) {
      await expect(page.getByText('No referrals yet')).toBeVisible();
      return;
    }

    await expect(page.getByRole('heading', { name: 'My referrals' })).toBeVisible();
    await expect(filterButton(page, 'Needs update')).toHaveAttribute('aria-pressed', 'true');
    await expect(filterButton(page, 'All')).toBeVisible();
    await expect(filterButton(page, 'Under contract')).toBeVisible();
    await expect(filterButton(page, 'Closed')).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search referrals' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
  });

  test('filters, searches, and expands a row without saving', async ({ page }) => {
    await loginAs(page, 'aha-agent');
    await waitForAgentReferralsPage(page);

    if (await isPageLevelEmpty(page)) {
      test.skip(true, 'AHA agent has no referrals');
      return;
    }

    await expect(page.getByRole('heading', { name: 'My referrals' })).toBeVisible();

    const needsUpdate = filterButton(page, 'Needs update');
    const all = filterButton(page, 'All');
    const closed = filterButton(page, 'Closed');

    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(needsUpdate).toHaveAttribute('aria-pressed', 'false');

    await closed.click();
    await expect(closed).toHaveAttribute('aria-pressed', 'true');

    await needsUpdate.click();
    await expect(needsUpdate).toHaveAttribute('aria-pressed', 'true');

    const row = await firstReferralRow(page);
    if (!row) {
      test.skip(true, 'AHA agent has no referrals on All');
      return;
    }

    await expect(page.getByText('Client', { exact: true })).toBeVisible();
    await expect(page.getByText('Status', { exact: true })).toBeVisible();
    await expect(page.getByText('Last activity', { exact: true })).toBeVisible();

    const waiting = page.getByText('Waiting on you');
    const moving = page.getByText('Moving along');
    await expect(waiting.or(moving).first()).toBeVisible();

    const borrowerLink = row.getByRole('link').first();
    const borrowerName = (await borrowerLink.innerText()).trim();
    expect(borrowerName.length).toBeGreaterThan(0);

    await page.getByRole('searchbox', { name: 'Search referrals' }).fill(borrowerName);
    await expect(borrowerLink).toBeVisible();

    await row.getByRole('button', { name: 'Add note' }).click();
    await expect(row.getByText('Where are they now?')).toBeVisible();
    await expect(row.getByPlaceholder('Add a note…')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'In Communication' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Closed' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Lost' })).toBeVisible();

    await page.getByRole('button', { name: 'Select' }).click();
    await expect(page.getByRole('checkbox', { name: `Select ${borrowerName}` }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
  });

  test('opens the agent detail layout from a row', async ({ page }) => {
    await loginAs(page, 'aha-agent');
    await waitForAgentReferralsPage(page);

    if (await isPageLevelEmpty(page)) {
      test.skip(true, 'AHA agent has no referrals');
      return;
    }

    const row = await firstReferralRow(page);
    if (!row) {
      test.skip(true, 'AHA agent has no referrals on All');
      return;
    }

    const borrowerLink = row.getByRole('link').first();
    const borrowerName = (await borrowerLink.innerText()).trim();
    await borrowerLink.click();

    await expect(page).toHaveURL(/\/referrals\/(?!new(?:\/|$))[^/?]+/);
    await expect(page.getByRole('heading', { name: borrowerName })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Where are they now?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
    await expect(page.getByRole('heading', { name: "Who's on it" })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Referral details' })).toHaveCount(0);

    await page.locator('main').getByRole('link', { name: 'Referrals' }).click();
    await expect(page).toHaveURL(/\/referrals\/?$/);
    await expect(page.getByRole('heading', { name: 'My referrals' })).toBeVisible();
  });
});
