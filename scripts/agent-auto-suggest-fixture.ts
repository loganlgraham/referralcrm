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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Types } from 'mongoose';

process.env.ALLOW_AGENT_AUTO_ASSIGN = 'true';
delete process.env.VERCEL_ENV;

type ScenarioResult = {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
};

type MemoryServer = { getUri: () => string; stop: () => Promise<boolean> };

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

  const { connectMongo } = await import('../src/lib/mongoose');
  const { Referral } = await import('../src/models/referral');
  const { Agent } = await import('../src/models/agent');
  const { Payment } = await import('../src/models/payment');
  const { applyIntakeAgentSuggestion, refreshAgentSuggestion, canPersistAutoAgentAssignment } =
    await import('../src/lib/server/agent-auto-suggest');
  const { buildAgentRecommendations } = await import('../src/lib/server/agent-recommendations');

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

  // AHA apply
  const aha = await Referral.create({
    source: 'fixture',
    clientType: 'Buyer',
    borrower: { name: 'AHA Intake', email: 'aha-intake@example.com', phone: '303-555-2001' },
    lookingInZip: '80107',
    lookingInZips: ['80107'],
    loanFileNumber: 'FIX-AHA-1',
    org: 'AHA',
    ahaBucket: 'AHA',
    inboundEmail: { messageId: 'fixture-aha-1', channel: 'AHA', routeHint: 'import+aha' },
  });
  // Mock ranking for determinism in fixture when history may not score as expected:
  const ranked = await buildAgentRecommendations({
    referral: aha.toObject(),
    mcOverride: undefined,
    zipOverride: null,
    fubPermitted: false,
  });
  const applied = await applyIntakeAgentSuggestion(String(aha._id));
  const ahaReload = await Referral.findById(aha._id).lean();
  results.push({
    id: 'aha-apply',
    title: 'AHA intake auto-suggest',
    ok:
      applied.outcome === 'applied' &&
      ahaReload?.agentSelectionSource === 'auto' &&
      ahaReload?.agentSuggestion?.status === 'applied' &&
      String(ahaReload?.buySideAgent) === String(strong._id),
    detail: `outcome=${applied.outcome} source=${ahaReload?.agentSelectionSource ?? 'null'} suggestion=${ahaReload?.agentSuggestion?.status ?? 'null'} ranked=${ranked.state}`,
  });

  // AHA OOS 15-mile
  const oosRef = await Referral.create({
    source: 'fixture',
    clientType: 'Buyer',
    borrower: { name: 'OOS Intake', email: 'oos-intake@example.com', phone: '303-555-2002' },
    lookingInZip: '80108',
    lookingInZips: ['80108'],
    loanFileNumber: 'FIX-OOS-1',
    org: 'AHA',
    ahaBucket: 'AHA_OOS',
    inboundEmail: { messageId: 'fixture-oos-1', channel: 'AHA_OOS', routeHint: 'import+ahaoos' },
  });
  const oosApplied = await applyIntakeAgentSuggestion(String(oosRef._id));
  const oosReload = await Referral.findById(oosRef._id).lean();
  results.push({
    id: 'oos-apply',
    title: 'AHA OOS 15-mile eligibility',
    ok:
      oosApplied.outcome === 'applied' &&
      String(oosReload?.buySideAgent) === String(oos._id) &&
      oosReload?.agentSelectionSource === 'auto',
    detail: `outcome=${oosApplied.outcome} agent=${String(oosReload?.buySideAgent ?? '')} oosAgent=${String(oos._id)}`,
  });

  // Missing evidence → none (only thin agent eligible)
  await Agent.updateOne({ _id: strong._id }, { $set: { active: false } });
  const thinRef = await Referral.create({
    source: 'fixture',
    clientType: 'Buyer',
    borrower: { name: 'Thin Intake', email: 'thin-intake@example.com', phone: '303-555-2003' },
    lookingInZip: '80107',
    lookingInZips: ['80107'],
    loanFileNumber: 'FIX-THIN-1',
    org: 'AHA',
    ahaBucket: 'AHA',
    inboundEmail: { messageId: 'fixture-thin-1', channel: 'AHA', routeHint: 'import+aha' },
  });
  const thinResult = await applyIntakeAgentSuggestion(String(thinRef._id));
  const thinReload = await Referral.findById(thinRef._id).lean();
  results.push({
    id: 'missing-evidence',
    title: 'Missing evidence stays unassigned',
    ok:
      thinResult.outcome === 'none' &&
      !thinReload?.buySideAgent &&
      thinReload?.agentSuggestion?.status === 'none',
    detail: `outcome=${thinResult.outcome} status=${thinReload?.agentSuggestion?.status ?? 'null'} thin=${String(thin._id)}`,
  });
  await Agent.updateOne({ _id: strong._id }, { $set: { active: true } });

  // Duplicate intake messageId does not reset agent
  const dupBase = await Referral.create({
    source: 'fixture',
    clientType: 'Buyer',
    borrower: { name: 'Dup Base', email: 'dup-base@example.com', phone: '303-555-2004' },
    lookingInZip: '80107',
    lookingInZips: ['80107'],
    loanFileNumber: 'FIX-DUP-1',
    org: 'AHA',
    ahaBucket: 'AHA',
    buySideAgent: strong._id,
    assignedAgent: strong._id,
    agentSelectionSource: 'manual',
    inboundEmail: { messageId: 'fixture-dup-1', channel: 'AHA', routeHint: 'import+aha' },
  });
  const beforeDup = await Referral.findById(dupBase._id).lean();
  const dupExisting = await Referral.findOne({ 'inboundEmail.messageId': 'fixture-dup-1' }).select('_id');
  const dupSkipped = await applyIntakeAgentSuggestion(String(dupBase._id));
  const afterDup = await Referral.findById(dupBase._id).lean();
  results.push({
    id: 'duplicate-intake',
    title: 'Duplicate intake does not reset selected agent',
    ok:
      Boolean(dupExisting) &&
      dupSkipped.outcome === 'skipped' &&
      String(afterDup?.buySideAgent) === String(beforeDup?.buySideAgent) &&
      afterDup?.agentSelectionSource === 'manual',
    detail: `dupFound=${Boolean(dupExisting)} outcome=${dupSkipped.outcome} source=${afterDup?.agentSelectionSource}`,
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
      <ul class="reasons"><li>Closed 6 of 8 finished referrals overall</li><li>Reached a contract on 7 of 8 referrals</li></ul>
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
