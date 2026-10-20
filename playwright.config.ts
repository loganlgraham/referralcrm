import { existsSync } from 'fs';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

const testEnvPath = join(process.cwd(), '.env.test.local');
if (existsSync(testEnvPath)) {
  loadEnv({ path: testEnvPath });
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

function isLocalBaseUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function localDevPort(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return 3000;
  } catch {
    return 3000;
  }
}

const localServer = isLocalBaseUrl(baseURL);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: localServer
    ? {
        command: `npx next dev --port ${localDevPort(baseURL)}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000
      }
    : undefined
});
