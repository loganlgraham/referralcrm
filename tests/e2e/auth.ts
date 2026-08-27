import { expect, test, type Page } from '@playwright/test';

export type E2ERole = 'admin' | 'aha-agent' | 'oos-agent' | 'mc';

interface RoleAuthConfig {
  identifierKey: string;
  passwordKey: string;
  postLoginUrl: RegExp;
}

function roleAuthConfig(role: E2ERole): RoleAuthConfig {
  switch (role) {
    case 'admin':
      return {
        identifierKey: 'E2E_ADMIN_IDENTIFIER',
        passwordKey: 'E2E_ADMIN_PASSWORD',
        postLoginUrl: /\/dashboard\/?$/
      };
    case 'aha-agent':
      return {
        identifierKey: 'E2E_AHA_AGENT_IDENTIFIER',
        passwordKey: 'E2E_AHA_AGENT_PASSWORD',
        postLoginUrl: /\/referrals\/?$/
      };
    case 'oos-agent':
      return {
        identifierKey: 'E2E_OOS_AGENT_IDENTIFIER',
        passwordKey: 'E2E_OOS_AGENT_PASSWORD',
        postLoginUrl: /\/referrals\/?$/
      };
    case 'mc':
      return {
        identifierKey: 'E2E_MC_IDENTIFIER',
        passwordKey: 'E2E_MC_PASSWORD',
        postLoginUrl: /\/referrals\/?$/
      };
    default: {
      const exhaustive: never = role;
      throw new Error(`Unhandled e2e role: ${exhaustive}`);
    }
  }
}

export function requireRole(role: E2ERole): { identifier: string; password: string } {
  const config = roleAuthConfig(role);
  const identifier = process.env[config.identifierKey]?.trim();
  const password = process.env[config.passwordKey]?.trim();
  test.skip(
    !identifier || !password,
    `Set ${config.identifierKey} and ${config.passwordKey} in .env.test.local`
  );
  return { identifier: identifier as string, password: password as string };
}

export async function loginAs(page: Page, role: E2ERole) {
  const { identifier, password } = requireRole(role);
  const { postLoginUrl } = roleAuthConfig(role);

  await page.goto('/login');
  await page.getByLabel('Username or email').fill(identifier);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(postLoginUrl, { timeout: 30_000 });
}
