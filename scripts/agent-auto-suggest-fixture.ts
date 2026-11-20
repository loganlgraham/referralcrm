/**
 * Isolated fixture DB proof for intake auto-suggest persistence.
 * Never targets production. Hosted Vercel previews stay assignment-disabled.
 *
 * Usage:
 *   ALLOW_AGENT_AUTO_ASSIGN=true pnpm tsx scripts/agent-auto-suggest-fixture.ts
 * Optional: MONGODB_URI=... to use an existing isolated DB instead of memory Mongo.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Types } from 'mongoose';

process.env.AGENT_AUTO_ASSIGN_FIXTURE_MODE = 'true';
process.env.ALLOW_AGENT_AUTO_ASSIGN = 'true';
process.env.RESEND_INBOUND_SECRET = 'fixture-inbound-secret';
process.env.RESEND_API_KEY = 'fixture-resend-key';
delete process.env.VERCEL_ENV;

type ScenarioResult = {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
};

type MemoryServer = { getUri: () => string; stop: () => Promise<boolean> };

function signBody(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function webhookRequest(rawBody: string): Request {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'resend-signature'
        ? signBody(rawBody, process.env.RESEND_INBOUND_SECRET as string)
        : null),
    },
    text: async () => rawBody,
  } as unknown as Request;
}

function inboundText(input: {
  first: string;
  last: string;
  email: string;
  phone: string;
  zip: string;
  loan: string;
}): string {
  return [
    `First: ${input.first}`,
    `Last: ${input.last}`,
    `BorrowerEmail: ${input.email}`,
    `Phone: ${input.phone}`,
    `ZipLookingIn: ${input.zip}`,
    `LoanNumber: ${input.loan}`,
  ].join('\n');
}

async function startIsolatedMongo(): Promise<{ uri: string; stop?: () => Promise<void> }> {
  if (process.env.MONGODB_URI) {
    return { uri: process.env.MONGODB_URI };
  }
  const candidates = [
    join(process.cwd(), 'node_modules/mongodb-memory-server'),
    '/tmp/mms-run/node_modules/mongodb-memory-server',
  ];
  const requireFrom = createRequire(join(process.cwd(), 'package.json'));
  let MongoMemoryServer: { create: () => Promise<MemoryServer> } | null = null;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      MongoMemoryServer = requireFrom(candidate).MongoMemoryServer;
      break;
    } catch {
      // try next
    }
  }
  if (!MongoMemoryServer) {
    throw new Error(
      'No isolated Mongo available. Set MONGODB_URI or install mongodb-memory-server (or use /tmp/mms-run).',
    );
  }
  const server = await MongoMemoryServer.create();
  return {
    uri: server.getUri('referralcrm-agent-auto-suggest-fixture'),
    stop: async () => {
      await server.stop();
    },
  };
}

async function main(): Promise<void> {
  const isolated = await startIsolatedMongo();
  process.env.MONGODB_URI = isolated.uri;
  const parsedMongo = new URL(isolated.uri);
  process.env.FIXTURE_MONGODB_HOST = parsedMongo.hostname;
  process.env.FIXTURE_MONGODB_PORT = parsedMongo.port;
  process.env.FIXTURE_MONGODB_DATABASE = parsedMongo.pathname.replace(/^\//u, '');

  const { connectMongo } = await import('../src/lib/mongoose');
  const { Referral } = await import('../src/models/referral');
  const { Agent } = await import('../src/models/agent');
  const { Payment } = await import('../src/models/payment');
  const { refreshAgentSuggestion, canPersistAutoAgentAssignment } =
    await import('../src/lib/server/agent-auto-suggest');
  const { buildAgentRecommendations } = await import('../src/lib/server/agent-recommendations');
  const { POST: inboundPost } = await import('../src/app/api/inbound-email/route');

  if (!canPersistAutoAgentAssignment()) {
    throw new Error('Fixture requires ALLOW_AGENT_AUTO_ASSIGN=true and VERCEL_ENV !== preview');
  }

  await connectMongo();
  await Promise.all([Referral.deleteMany({}), Agent.deleteMany({}), Payment.deleteMany({})]);

  const strong = await Agent.create({
    name: 'Fixture Leah',
    email: 'fixture-leah@example.com',
    phone: '303-555-0101',
    active: true,
    ahaDesignation: 'AHA',
    zipCoverage: [],
  });
  const oos = await Agent.create({
    name: 'Fixture OOS',
    email: 'fixture-oos@example.com',
    phone: '303-555-0102',
    active: true,
    ahaDesignation: 'AHA_OOS',
    zipCoverage: ['80107', '80108'],
  });
  const thin = await Agent.create({
    name: 'Fixture Thin',
    email: 'fixture-thin@example.com',
    phone: '303-555-0103',
    active: true,
    ahaDesignation: 'AHA',
    zipCoverage: [],
  });

  // Seed enough finished history (with payment records) for strong AHA + OOS agents.
  const historyDocs = [];
  for (let i = 0; i < 6; i += 1) {
    historyDocs.push({
      source: 'fixture',
      clientType: 'Buyer',
      borrower: { name: `Hist ${i}`, email: `hist${i}@example.com`, phone: `303-555-${1000 + i}` },
      lookingInZip: '80107',
      lookingInZips: ['80107'],
      loanFileNumber: `FIX-HIST-${i}`,
      org: 'AHA',
      ahaBucket: 'AHA',
      assignedAgent: strong._id,
      buySideAgent: strong._id,
      status: 'Closed',
      buyStatus: 'Closed',
      sellStatus: 'New Lead',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
  }
  for (let i = 0; i < 6; i += 1) {
    historyDocs.push({
      source: 'fixture',
      clientType: 'Buyer',
      borrower: { name: `OosHist ${i}`, email: `ooshist${i}@example.com`, phone: `303-555-${2000 + i}` },
      lookingInZip: '80108',
      lookingInZips: ['80108'],
      loanFileNumber: `FIX-OOS-HIST-${i}`,
      org: 'AHA',
      ahaBucket: 'AHA_OOS',
      assignedAgent: oos._id,
      buySideAgent: oos._id,
      status: 'Closed',
      buyStatus: 'Closed',
      sellStatus: 'New Lead',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
  }
  const inserted = await Referral.insertMany(historyDocs);
  await Payment.insertMany(
    inserted.map((doc) => ({
      referralId: doc._id,
      agentId: doc.buySideAgent,
      side: 'buy',
      status: 'closed',
      usedAssignedAgent: true,
      usedAfcAtClosing: true,
      receivedAmountCents: 100000,
      expectedAmountCents: 100000,
    })),
  );

  const results: ScenarioResult[] = [];

  async function createViaInbound(input: {
    messageId: string;
    channel: 'AHA' | 'AHA_OOS';
    first: string;
    last: string;
    email: string;
    phone: string;
    zip: string;
    loan: string;
  }): Promise<{ status: number; body: any; referralId: string | null }> {
    (globalThis as { fetch?: typeof fetch }).fetch = (async () => ({
      ok: true,
      json: async () => ({
        id: input.messageId,
        from: 'Fixture <fixture@example.com>',
        to: [`import+${input.channel === 'AHA_OOS' ? 'ahaoos' : 'aha'}@referrio.app`],
        subject: input.channel === 'AHA_OOS' ? 'AHA Out of State Agent Needed' : 'Add Contact',
        text: inboundText(input),
        attachments: [],
      }),
    })) as unknown as typeof fetch;

    const rawBody = JSON.stringify({
      type: 'email.received',
      data: { email_id: input.messageId },
    });
    const response = await inboundPost(webhookRequest(rawBody) as any);
    const body = await response.json();
    return {
      status: response.status,
      body,
      referralId: typeof body?.referralId === 'string' ? body.referralId : null,
    };
  }

  // AHA apply
  const ahaCreated = await createViaInbound({
    messageId: 'fixture-aha-1',
    channel: 'AHA',
    first: 'AHA',
    last: 'Intake',
    email: 'aha-intake@example.com',
    phone: '303-555-2001',
    zip: '80107',
    loan: 'FIX-AHA-1',
  });
  if (!ahaCreated.referralId) throw new Error(`AHA intake fixture failed: ${JSON.stringify(ahaCreated.body)}`);
  const aha = await Referral.findById(ahaCreated.referralId).lean();
  if (!aha) throw new Error('AHA referral missing after inbound create');
  const ranked = await buildAgentRecommendations({
    referral: aha,
    mcOverride: undefined,
    zipOverride: null,
    fubPermitted: false,
  });
  const ahaReload = await Referral.findById(aha._id).lean();
  results.push({
    id: 'aha-apply',
    title: 'AHA intake auto-suggest',
    ok:
      ahaCreated.status === 200 &&
      ahaReload?.agentSelectionSource === 'auto' &&
      ahaReload?.agentSuggestion?.status === 'applied' &&
      String(ahaReload?.buySideAgent) === String(strong._id),
    detail: `status=${ahaCreated.status} source=${ahaReload?.agentSelectionSource ?? 'null'} suggestion=${ahaReload?.agentSuggestion?.status ?? 'null'} ranked=${ranked.state}`,
  });

  // AHA OOS 15-mile
  const oosCreated = await createViaInbound({
    messageId: 'fixture-oos-1',
    channel: 'AHA_OOS',
    first: 'OOS',
    last: 'Intake',
    email: 'oos-intake@example.com',
    phone: '303-555-2002',
    zip: '80108',
    loan: 'FIX-OOS-1',
  });
  if (!oosCreated.referralId) throw new Error(`OOS intake fixture failed: ${JSON.stringify(oosCreated.body)}`);
  const oosReload = await Referral.findById(oosCreated.referralId).lean();
  results.push({
    id: 'oos-apply',
    title: 'AHA OOS 15-mile eligibility',
    ok:
      oosCreated.status === 200 &&
      String(oosReload?.buySideAgent) === String(oos._id) &&
      oosReload?.agentSelectionSource === 'auto',
    detail: `status=${oosCreated.status} agent=${String(oosReload?.buySideAgent ?? '')} oosAgent=${String(oos._id)}`,
  });

  // Missing evidence → none (only thin agent eligible)
  await Agent.updateOne({ _id: strong._id }, { $set: { active: false } });
  const thinCreated = await createViaInbound({
    messageId: 'fixture-thin-1',
    channel: 'AHA',
    first: 'Thin',
    last: 'Intake',
    email: 'thin-intake@example.com',
    phone: '303-555-2003',
    zip: '80107',
    loan: 'FIX-THIN-1',
  });
  if (!thinCreated.referralId) throw new Error(`Thin intake fixture failed: ${JSON.stringify(thinCreated.body)}`);
  const thinReload = await Referral.findById(thinCreated.referralId).lean();
  results.push({
    id: 'missing-evidence',
    title: 'Missing evidence stays unassigned',
    ok:
      thinCreated.status === 200 &&
      !thinReload?.buySideAgent &&
      thinReload?.agentSuggestion?.status === 'none',
    detail: `status=${thinCreated.status} suggestion=${thinReload?.agentSuggestion?.status ?? 'null'} thin=${String(thin._id)}`,
  });
  await Agent.updateOne({ _id: strong._id }, { $set: { active: true } });

  // Duplicate intake messageId does not reset agent
  const dupCreated = await createViaInbound({
    messageId: 'fixture-dup-1',
    channel: 'AHA',
    first: 'Dup',
    last: 'Base',
    email: 'dup-base@example.com',
    phone: '303-555-2004',
    zip: '80107',
    loan: 'FIX-DUP-1',
  });
  if (!dupCreated.referralId) throw new Error(`Duplicate base intake failed: ${JSON.stringify(dupCreated.body)}`);
  await Referral.updateOne(
    { _id: dupCreated.referralId },
    {
      $set: {
        buySideAgent: thin._id,
        assignedAgent: thin._id,
        agentSelectionSource: 'manual',
      },
    },
  );
  const beforeDup = await Referral.findById(dupCreated.referralId).lean();
  const dupRetry = await createViaInbound({
    messageId: 'fixture-dup-1',
    channel: 'AHA',
    first: 'Dup',
    last: 'Base',
    email: 'dup-base@example.com',
    phone: '303-555-2004',
    zip: '80107',
    loan: 'FIX-DUP-1',
  });
  const dupCount = await Referral.countDocuments({ 'inboundEmail.messageId': 'fixture-dup-1' });
  const afterDup = await Referral.findById(dupCreated.referralId).lean();
  results.push({
    id: 'duplicate-intake',
    title: 'Duplicate intake does not reset selected agent',
    ok:
      dupRetry.status === 202 &&
      dupCount === 1 &&
      String(afterDup?.buySideAgent) === String(beforeDup?.buySideAgent) &&
      afterDup?.agentSelectionSource === 'manual',
    detail: `retryStatus=${dupRetry.status} count=${dupCount} source=${afterDup?.agentSelectionSource}`,
  });

  // Override persistence across refresh
  const overrideRef = await Referral.create({
    source: 'fixture',
    clientType: 'Buyer',
    borrower: { name: 'Override', email: 'override@example.com', phone: '303-555-2005' },
    lookingInZip: '80107',
    lookingInZips: ['80107'],
    loanFileNumber: 'FIX-OVR-1',
    org: 'AHA',
    ahaBucket: 'AHA',
    buySideAgent: thin._id,
    assignedAgent: thin._id,
    agentSelectionSource: 'manual',
    agentSuggestion: {
      agentId: strong._id,
      agentName: 'Fixture Leah',
      policyVersion: 'draft',
      provisional: false,
      reasons: ['prior suggestion'],
      status: 'skipped',
      skippedReason: 'already_assigned',
      updatedAt: new Date(),
    },
  });
  await Referral.updateOne({ _id: overrideRef._id }, { $set: { lookingInZip: '80014', lookingInZips: ['80014'] } });
  const refreshed = await refreshAgentSuggestion(String(overrideRef._id));
  const afterRefresh = await Referral.findById(overrideRef._id).lean();
  results.push({
    id: 'override-persist',
    title: 'Manual override survives ZIP recalculation',
    ok:
      refreshed.outcome === 'skipped' &&
      String(afterRefresh?.buySideAgent) === String(thin._id) &&
      afterRefresh?.agentSelectionSource === 'manual',
    detail: `outcome=${refreshed.outcome} agent=${String(afterRefresh?.buySideAgent)} source=${afterRefresh?.agentSelectionSource}`,
  });

  const html = renderHtml(results);
  const outDir = join(process.cwd(), 'tests/fixtures');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'agent-auto-suggest-preview.html');
  writeFileSync(outPath, html, 'utf8');

  const port = Number(process.env.FIXTURE_PREVIEW_PORT ?? 4177);
  const server = createServer((req, res) => {
    if (req.url === '/agent-auto-suggest-preview.html' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(outPath));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${port}/agent-auto-suggest-preview.html`;
  const failed = results.filter((row) => !row.ok);
  console.log(JSON.stringify({ fixturePreviewUrl: url, mongoUriHost: new URL(isolated.uri).host, passed: failed.length === 0, results }, null, 2));
  if (failed.length > 0) {
    server.close();
    await isolated.stop?.();
    process.exitCode = 1;
    return;
  }
  // Keep server up briefly for the report URL, then exit.
  setTimeout(() => {
    server.close();
    void isolated.stop?.().finally(() => process.exit(0));
  }, 1500);
}

function renderHtml(results: ScenarioResult[]): string {
  const rows = results
    .map(
      (row) =>
        `<tr data-id="${row.id}"><td>${escape(row.title)}</td><td class="${row.ok ? 'ok' : 'bad'}">${row.ok ? 'pass' : 'fail'}</td><td>${escape(row.detail)}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent auto-suggest fixture</title>
  <style>
    :root { color-scheme: light; font-family: Manrope, system-ui, sans-serif; }
    body { margin: 0; background: #f6f4ef; color: #1c1917; }
    main { max-width: 920px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { font-size: 1.5rem; margin: 0 0 8px; }
    p { color: #57534e; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 10px; background: #e7e5e4; font-size: 12px; }
    .card { background: #fff; border: 1px solid #d6d3d1; border-radius: 12px; padding: 16px; margin-top: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
    .ok { color: #166534; font-weight: 700; }
    .bad { color: #b91c1c; font-weight: 700; }
    .team { display: grid; gap: 8px; }
    .reasons { margin: 4px 0 0; padding-left: 18px; color: #57534e; font-size: 12px; }
    @media (max-width: 390px) {
      main { padding: 12px; }
      h1 { font-size: 1.2rem; }
      table { font-size: 12px; }
      th:nth-child(3), td:nth-child(3) { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Intake auto-suggest fixture</h1>
    <p>Isolated DB only. Hosted Vercel previews keep automatic assignment disabled.</p>
    <div class="card team" aria-label="Auto-suggested example">
      <div><strong>Buy-side Agent</strong> <span class="badge">Auto-suggested</span></div>
      <div>Fixture Leah</div>
      <ul class="reasons"><li>Closed 6 of 8 finished referrals overall</li><li>Reached a contract on 7 of 8 referrals with known contract results</li></ul>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Scenario</th><th>Result</th><th>Detail</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <p>Desktop and 390px layouts covered by this page’s responsive CSS.</p>
  </main>
</body>
</html>`;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
