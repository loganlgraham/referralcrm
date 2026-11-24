/**
 * Real-application fixture for the admin-approved Paired → mock FUB flow.
 * It always creates memory Mongo, verifies the live target, and drives Next.js
 * through a browser. No live Follow Up Boss client exists in this process.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { chromium, type Browser, type Page } from '@playwright/test';
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { encode } from 'next-auth/jwt';

import { connectMongo } from '../src/lib/mongoose';
import { Agent } from '../src/models/agent';
import { IntelligenceAgentLink, IntelligenceLink } from '../src/models/intelligence-link';
import { MockFubPerson, MockFubSendAttempt } from '../src/models/mock-fub';
import { Referral } from '../src/models/referral';
import { User } from '../src/models/user';

type FixtureReferral = {
  id: string;
  name: string;
};

type ScenarioResult = {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
};

const port = Number(process.env.PAIRED_FUB_FIXTURE_PORT ?? 4188);
const baseUrl = `http://127.0.0.1:${port}`;
const fixtureRunId = process.env.FUB_FIXTURE_RUN_ID ?? 'paired-fub-missing-run';
const configuredMongoUri = process.env.MONGODB_URI ?? '';
const databaseName = configuredMongoUri
  ? new URL(configuredMongoUri).pathname.replace(/^\//u, '')
  : '';
const adminEmail = 'paired-fub-admin@example.com';
const adminPassword = 'Fixture-only-password-266!';

async function waitForApp(child: ChildProcess, timeoutMs = 120_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before the fixture opened (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.status < 500) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for the fixture Next.js app.');
}

async function authenticateAdmin(page: Page, adminId: Types.ObjectId): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET as string;
  const token = await encode({
    secret,
    maxAge: 60 * 60,
    token: {
      sub: String(adminId),
      name: 'Fixture Admin',
      email: adminEmail,
      role: 'admin',
    },
  });
  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${baseUrl}/dashboard`);
  await page.waitForURL(/\/dashboard\/?$/u, { timeout: 30_000 });
}

async function moveToPaired(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Move to Paired' }).click();
}

async function createReferral(input: {
  suffix: string;
  name: string;
  assignedAgentId: Types.ObjectId;
  selectionSource?: 'auto' | 'manual';
  bucket?: 'AHA' | 'AHA_OOS';
}): Promise<FixtureReferral> {
  const document = await Referral.create({
    source: 'FixtureSource',
    clientType: 'Buyer',
    borrower: {
      firstName: input.name.split(' ')[0],
      lastName: input.name.split(' ').slice(1).join(' '),
      name: input.name,
      email: `${input.suffix}@fixture.example`,
      phone: `303-555-${input.suffix.padStart(4, '0').slice(-4)}`,
    },
    lookingInZip: '80014',
    lookingInZips: ['80014', '80231'],
    borrowerCurrentAddress: '3190 South Vaughn Way, Aurora, CO 80014',
    stageOnTransfer: 'Pre-approved',
    loanType: 'Conventional',
    loanFileNumber: `PAIR-FUB-${input.suffix}`,
    org: 'AHA',
    ahaBucket: input.bucket ?? 'AHA',
    inboundEmail: { messageId: `fixture-${input.suffix}`, channel: input.bucket ?? 'AHA' },
    assignedAgent: input.assignedAgentId,
    buySideAgent: input.assignedAgentId,
    agentSelectionSource: input.selectionSource ?? 'manual',
    status: 'New Lead',
    buyStatus: 'New Lead',
    sellStatus: 'New Lead',
  });
  return { id: String(document._id), name: input.name };
}

async function seedFixture(): Promise<{
  adminId: Types.ObjectId;
  referrals: Record<string, FixtureReferral>;
}> {
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const admin = await User.create({
    name: 'Fixture Admin',
    username: 'paired-fub-admin',
    email: adminEmail,
    role: 'admin',
    passwordHash,
  });
  const [suggested, manual, ambiguousOther, unmapped] = await Agent.create([
    {
      name: 'Suggested Agent',
      email: 'suggested-agent@fixture.example',
      phone: '303-555-0111',
      active: true,
      ahaDesignation: 'AHA',
    },
    {
      name: 'Manual Override Agent',
      email: 'manual-agent@fixture.example',
      phone: '303-555-0112',
      active: true,
      ahaDesignation: 'AHA',
    },
    {
      name: 'Ambiguous Other Agent',
      email: 'ambiguous-agent@fixture.example',
      phone: '303-555-0113',
      active: true,
      ahaDesignation: 'AHA',
    },
    {
      name: 'Unmapped Agent',
      email: 'unmapped-agent@fixture.example',
      phone: '303-555-0114',
      active: true,
      ahaDesignation: 'AHA',
    },
  ]);

  const audit = (nextPersonId: number) => [
    {
      actorId: admin._id,
      at: new Date(),
      action: 'link',
      previousPersonId: null,
      nextPersonId,
    },
  ];
  await IntelligenceAgentLink.create([
    {
      organization: 'AHA',
      fubAccountId: '1846967076',
      agentId: manual._id,
      fubUserId: 71,
      audit: audit(71),
    },
    {
      organization: 'AHA',
      fubAccountId: '1846967076',
      agentId: suggested._id,
      fubUserId: 72,
      audit: audit(72),
    },
    {
      organization: 'AHA',
      fubAccountId: '1846967076',
      agentId: ambiguousOther._id,
      fubUserId: 72,
      audit: audit(72),
    },
  ]);

  const entries = await Promise.all([
    createReferral({
      suffix: '1001',
      name: 'Weston Fixture',
      assignedAgentId: manual._id,
    }),
    createReferral({
      suffix: '1002',
      name: 'Missing Mapping',
      assignedAgentId: unmapped._id,
    }),
    createReferral({
      suffix: '1003',
      name: 'Partial Recovery',
      assignedAgentId: manual._id,
    }),
    createReferral({
      suffix: '1004',
      name: 'Ambiguous Timeout',
      assignedAgentId: manual._id,
    }),
    createReferral({
      suffix: '1005',
      name: 'Ordinary Reload',
      assignedAgentId: manual._id,
    }),
    createReferral({
      suffix: '1006',
      name: 'Mobile Fixture',
      assignedAgentId: manual._id,
    }),
    createReferral({
      suffix: '1007',
      name: 'Out Of Scope',
      assignedAgentId: manual._id,
      bucket: 'AHA_OOS',
    }),
    createReferral({
      suffix: '1008',
      name: 'Duplicate Approval',
      assignedAgentId: manual._id,
    }),
  ]);
  const keys = [
    'weston',
    'missing',
    'partial',
    'timeout',
    'ordinary',
    'mobile',
    'oos',
    'duplicate',
  ];
  const referrals = Object.fromEntries(keys.map((key, index) => [key, entries[index]]));

  await IntelligenceLink.create({
    organization: 'AHA',
    fubAccountId: '1846967076',
    referralId: new Types.ObjectId(referrals.weston.id),
    participantKey: 'borrower',
    fubPersonId: 38620,
    audit: audit(38620),
  });
  await MockFubPerson.create({
    fixtureRunId,
    personId: 38620,
    referralId: new Types.ObjectId(referrals.weston.id),
    firstName: 'Weston',
    lastName: 'Fixture',
    email: 'weston-preserved@fixture.example',
    phone: '303-555-3862',
    assignedUserId: 44,
    fields: { referrioSource: 'Preserve this populated value' },
    notes: [],
    operationKeys: [],
  });

  return { adminId: admin._id, referrals };
}

async function statusPost(page: Page, referralId: string): Promise<number> {
  return page.evaluate(async ({ id }) => {
    const response = await fetch(`/api/referrals/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'Paired',
        side: 'buy',
        source: 'referral_detail',
      }),
    });
    return response.status;
  }, { id: referralId });
}

async function approvalPost(page: Page, referralId: string, key: string) {
  return page.evaluate(async ({ id, approvalKey }) => {
    const response = await fetch(`/api/referrals/${id}/fub-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalKey }),
    });
    return { status: response.status, body: await response.json() };
  }, { id: referralId, approvalKey: key });
}

async function approvalKey(page: Page, referralId: string): Promise<string> {
  return page.evaluate(async ({ id }) => {
    const response = await fetch(`/api/referrals/${id}/fub-send`, {
      cache: 'no-store',
    });
    const body = await response.json();
    if (!response.ok || typeof body.approvalKey !== 'string') {
      throw new Error(body.error ?? 'Fixture approval key was unavailable.');
    }
    return body.approvalKey;
  }, { id: referralId });
}

async function runBrowserFlow(
  browser: Browser,
  adminId: Types.ObjectId,
  referrals: Record<string, FixtureReferral>,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage();
  await authenticateAdmin(page, adminId);

  await page.goto(`${baseUrl}/referrals/${referrals.weston.id}`);
  await moveToPaired(page);
  await page.getByRole('heading', { name: 'Confirm Paired → FUB' }).waitFor();
  const selectedManual =
    (await page.getByText('Manual Override Agent', { exact: true }).count()) > 0 &&
    (await page.getByText('Manual override', { exact: true }).count()) > 0;
  const desktopFits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  await page.getByRole('button', { name: 'Pair and send to FUB' }).click();
  await page.getByText('Paired saved and sent to the mock FUB fixture.').waitFor();
  await page.screenshot({
    path: '/tmp/paired-fub-desktop.png',
    fullPage: true,
  });
  const westonAttempt = await MockFubSendAttempt.findOne({
    fixtureRunId,
    referralId: new Types.ObjectId(referrals.weston.id),
  }).lean<Record<string, any> | null>();
  const westonLink = await IntelligenceLink.findOne({
    referralId: new Types.ObjectId(referrals.weston.id),
    participantKey: 'borrower',
  }).lean<{ fubPersonId?: number } | null>();
  const westonPerson = await MockFubPerson.findOne({
    fixtureRunId,
    personId: 38620,
  }).lean<Record<string, any> | null>();
  results.push({
    id: 'manual-existing-link',
    title: 'Manual override and existing customer link',
    ok:
      selectedManual &&
      desktopFits &&
      westonAttempt?.status === 'success' &&
      westonLink?.fubPersonId === 38620 &&
      westonPerson?.fields?.referrioSource === 'Preserve this populated value' &&
      westonPerson?.assignedUserId === 71,
    detail: `status=${westonAttempt?.status} person=${westonLink?.fubPersonId} assigned=${westonPerson?.assignedUserId}`,
  });

  await statusPost(page, referrals.duplicate.id);
  const duplicateApprovalKey = await approvalKey(page, referrals.duplicate.id);
  const duplicateResponses = await Promise.all([
    approvalPost(page, referrals.duplicate.id, duplicateApprovalKey),
    approvalPost(page, referrals.duplicate.id, duplicateApprovalKey),
  ]);
  const attemptAfterDuplicate = await MockFubSendAttempt.findOne({
    fixtureRunId,
    referralId: new Types.ObjectId(referrals.duplicate.id),
  }).lean<Record<string, any> | null>();
  results.push({
    id: 'duplicate-approval',
    title: 'Double-click and repeated approval dedupe',
    ok:
      duplicateResponses.every((response) =>
        ['running', 'success'].includes(response.body.status),
      ) &&
      attemptAfterDuplicate?.status === 'success' &&
      attemptAfterDuplicate?.steps?.every((step: { attempts?: number }) => step.attempts === 1),
    detail: `responses=${duplicateResponses.map((response) => response.body.status).join(',')} attempts=${attemptAfterDuplicate?.steps?.map((step: { attempts?: number }) => step.attempts).join(',')}`,
  });

  await page.goto(`${baseUrl}/referrals/${referrals.missing.id}`);
  await moveToPaired(page);
  await page.getByText(/does not have a verified FUB user mapping/u).waitFor();
  await page.getByRole('button', { name: 'Move to Paired only' }).click();
  await page.getByText('Referral moved to Paired. Nothing was sent to FUB.').waitFor();
  results.push({
    id: 'missing-mapping',
    title: 'Missing mapping blocks send',
    ok:
      (await MockFubSendAttempt.countDocuments({
        fixtureRunId,
        referralId: new Types.ObjectId(referrals.missing.id),
      })) === 0,
    detail: 'Paired without a mock send attempt',
  });

  await page.goto(`${baseUrl}/referrals/${referrals.partial.id}`);
  await moveToPaired(page);
  await page.getByRole('button', { name: 'Pair and send to FUB' }).click();
  await page.getByText(/mock FUB send is incomplete/u).waitFor();
  await page.getByRole('button', { name: 'Retry safe steps' }).click();
  await page.getByText(/mock FUB send recovered and finished/u).waitFor();
  const partialAttempt = await MockFubSendAttempt.findOne({
    fixtureRunId,
    referralId: new Types.ObjectId(referrals.partial.id),
  }).lean<Record<string, any> | null>();
  results.push({
    id: 'partial-retry',
    title: 'Partial failure retries only the failed step',
    ok:
      partialAttempt?.status === 'success' &&
      partialAttempt?.steps?.map((step: { attempts?: number }) => step.attempts).join(',') ===
        '1,1,2,1',
    detail: `status=${partialAttempt?.status} attempts=${partialAttempt?.steps?.map((step: { attempts?: number }) => step.attempts).join(',')}`,
  });

  await page.goto(`${baseUrl}/referrals/${referrals.timeout.id}`);
  await moveToPaired(page);
  await page.getByRole('button', { name: 'Pair and send to FUB' }).click();
  await page.getByText(/mock FUB result is uncertain/u).waitFor();
  const timeoutApprovalKey = await approvalKey(page, referrals.timeout.id);
  const timeoutRetry = await approvalPost(
    page,
    referrals.timeout.id,
    timeoutApprovalKey,
  );
  const timeoutAttempt = await MockFubSendAttempt.findOne({
    fixtureRunId,
    referralId: new Types.ObjectId(referrals.timeout.id),
  }).lean<Record<string, any> | null>();
  results.push({
    id: 'ambiguous-timeout',
    title: 'Timeout blocks blind resend',
    ok:
      timeoutRetry.body.status === 'ambiguous' &&
      timeoutAttempt?.steps?.find((step: { name?: string }) => step.name === 'assign_agent')
        ?.attempts === 1,
    detail: `retry=${timeoutRetry.body.status} assignmentAttempts=${timeoutAttempt?.steps?.find((step: { name?: string }) => step.name === 'assign_agent')?.attempts}`,
  });

  await page.goto(`${baseUrl}/referrals/${referrals.ordinary.id}`);
  await page.reload();
  const ordinaryStatus = await statusPost(page, referrals.ordinary.id);
  results.push({
    id: 'ordinary-paired',
    title: 'Reload and ordinary Paired update never approve',
    ok:
      ordinaryStatus === 200 &&
      (await MockFubSendAttempt.countDocuments({
        fixtureRunId,
        referralId: new Types.ObjectId(referrals.ordinary.id),
      })) === 0,
    detail: `statusApi=${ordinaryStatus} attempts=0`,
  });

  await page.goto(`${baseUrl}/referrals/${referrals.oos.id}`);
  await moveToPaired(page);
  await page.getByText('Referral status updated').waitFor();
  results.push({
    id: 'oos-out-of-scope',
    title: 'AHA OOS remains out of scope',
    ok:
      (await page.getByRole('heading', { name: 'Confirm Paired → FUB' }).count()) === 0 &&
      (await MockFubSendAttempt.countDocuments({
        fixtureRunId,
        referralId: new Types.ObjectId(referrals.oos.id),
      })) === 0,
    detail: 'Paired normally with no FUB confirmation or attempt',
  });

  const unauthenticated = await browser.newContext();
  const unauthenticatedResponse = await unauthenticated.request.get(
    `${baseUrl}/api/referrals/${referrals.mobile.id}/fub-send`,
    { headers: { Origin: baseUrl, 'Sec-Fetch-Site': 'same-origin' } },
  );
  results.push({
    id: 'authorization',
    title: 'Unauthorized fixture request is rejected',
    ok: unauthenticatedResponse.status() === 401,
    detail: `status=${unauthenticatedResponse.status()}`,
  });
  await unauthenticated.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await authenticateAdmin(mobilePage, adminId);
  await mobilePage.goto(`${baseUrl}/referrals/${referrals.mobile.id}`);
  await moveToPaired(mobilePage);
  await mobilePage.getByRole('heading', { name: 'Confirm Paired → FUB' }).waitFor();
  await mobilePage.screenshot({
    path: '/tmp/paired-fub-390.png',
    fullPage: true,
  });
  const mobileBox = await mobilePage
    .getByRole('heading', { name: 'Confirm Paired → FUB' })
    .boundingBox();
  const mobileButtons = await Promise.all(
    [
      mobilePage.getByRole('button', { name: 'Pair and send to FUB' }),
      mobilePage.getByRole('button', { name: 'Pair without sending' }),
    ].map((button) => button.boundingBox()),
  );
  const mobileFits = await mobilePage.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  await mobilePage.getByRole('button', { name: 'Pair and send to FUB' }).click();
  await mobilePage.getByText('Paired saved and sent to the mock FUB fixture.').waitFor();
  results.push({
    id: 'mobile-390',
    title: '390px real application flow',
    ok:
      mobileFits &&
      Boolean(mobileBox && mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390) &&
      mobileButtons.every(
        (box) => box !== null && box.x >= 0 && box.x + box.width <= 390,
      ),
    detail: mobileBox ? `x=${mobileBox.x} width=${mobileBox.width}` : 'missing confirmation',
  });

  await mobile.close();
  await desktop.close();
  return results;
}

function renderResults(results: readonly ScenarioResult[], referrals: Record<string, FixtureReferral>): void {
  const rows = results
    .map(
      (result) =>
        `<tr><td>${result.title}</td><td>${result.ok ? 'pass' : 'fail'}</td><td>${result.detail}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paired FUB fixture</title></head><body><main><h1>Paired → FUB fixture</h1><p><a href="${baseUrl}/referrals/${referrals.weston.id}">Open the real fixture referral</a></p><table><thead><tr><th>Scenario</th><th>Result</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
  writeFileSync('/tmp/paired-fub-preview.html', html, 'utf8');
}

async function main(): Promise<void> {
  if (!configuredMongoUri || !databaseName.includes('fixture')) {
    throw new Error('The fixture worker requires an explicit isolated memory Mongo URI.');
  }
  const mongoUri = configuredMongoUri;
  const parsedMongo = new URL(mongoUri);
  Object.assign(process.env, {
    MONGODB_URI: mongoUri,
    AGENT_AUTO_ASSIGN_FIXTURE_MODE: 'true',
    ALLOW_AGENT_AUTO_ASSIGN: 'true',
    FUB_MOCK_FIXTURE_MODE: 'true',
    FUB_FIXTURE_RUN_ID: fixtureRunId,
    FIXTURE_MONGODB_HOST: parsedMongo.hostname,
    FIXTURE_MONGODB_PORT: parsedMongo.port,
    FIXTURE_MONGODB_DATABASE: databaseName,
    NEXTAUTH_URL: baseUrl,
    NEXTAUTH_SECRET: 'paired-fub-fixture-secret',
    AUTH_SECRET: 'paired-fub-fixture-secret',
    REFERRIO_FUB_ACCOUNT_ID: '1846967076',
  });
  delete process.env.VERCEL_ENV;

  await connectMongo();
  const { adminId, referrals } = await seedFixture();
  process.env.FUB_MOCK_SCENARIOS = JSON.stringify({
    [referrals.partial.id]: {
      operation: 'populate_fields',
      mode: 'definitive_once',
    },
    [referrals.timeout.id]: {
      operation: 'assign_agent',
      mode: 'ambiguous_after_once',
    },
  });

  const nextProcess = spawn(
    'pnpm',
    ['exec', 'next', 'dev', '--port', String(port)],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const appLogs: string[] = [];
  nextProcess.stdout?.on('data', (chunk) => appLogs.push(String(chunk)));
  nextProcess.stderr?.on('data', (chunk) => appLogs.push(String(chunk)));

  let browser: Browser | null = null;
  try {
    await waitForApp(nextProcess);
    browser = await chromium.launch();
    const results = await runBrowserFlow(browser, adminId, referrals);
    renderResults(results, referrals);
    const failed = results.filter((result) => !result.ok);
    console.log(
      JSON.stringify(
        {
          fixturePreviewUrl: `${baseUrl}/referrals/${referrals.weston.id}`,
          resultPreviewFile: '/tmp/paired-fub-preview.html',
          databaseHost: parsedMongo.hostname,
          databaseName,
          passed: failed.length === 0,
          results,
        },
        null,
        2,
      ),
    );
    if (failed.length > 0) {
      process.exitCode = 1;
    }
    if (process.env.FIXTURE_SERVE === 'true' && failed.length === 0) {
      console.log(`Fixture remains available at ${baseUrl}/referrals/${referrals.weston.id}`);
      await new Promise<void>((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
    }
  } catch (error) {
    console.error(error);
    console.error(appLogs.join('').slice(-8000));
    process.exitCode = 1;
  } finally {
    await browser?.close();
    nextProcess.kill('SIGTERM');
    await mongoose.disconnect();
  }
}

void main();
