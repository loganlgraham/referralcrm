import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type MemoryServer = {
  getUri: (databaseName: string) => string;
  stop: () => Promise<boolean>;
};

function loadMemoryServer(): { create: () => Promise<MemoryServer> } {
  const candidates = [
    join(process.cwd(), 'node_modules/mongodb-memory-server'),
    '/tmp/mms-run/node_modules/mongodb-memory-server',
  ];
  const requireFrom = createRequire(join(process.cwd(), 'package.json'));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return requireFrom(candidate).MongoMemoryServer;
    } catch {
      // Try the next isolated local installation.
    }
  }
  throw new Error('mongodb-memory-server is required for the Paired → FUB fixture.');
}

async function main(): Promise<void> {
  const MongoMemoryServer = loadMemoryServer();
  const memory = await MongoMemoryServer.create();
  const suffix = Date.now().toString(36);
  const databaseName = `referrio-fub-fixture-${suffix}`;
  const fixtureRunId = `paired-fub-${suffix}`;
  const mongoUri = memory.getUri(databaseName);
  const port = String(4100 + Math.floor(Math.random() * 1000));

  const worker = spawn(
    'pnpm',
    ['exec', 'tsx', 'scripts/paired-fub-fixture.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MONGODB_URI: mongoUri,
        FUB_FIXTURE_RUN_ID: fixtureRunId,
        PAIRED_FUB_FIXTURE_PORT: process.env.PAIRED_FUB_FIXTURE_PORT ?? port,
      },
      stdio: 'inherit',
    },
  );

  const exitCode = await new Promise<number>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', (code) => resolve(code ?? 1));
  });
  await memory.stop();
  process.exitCode = exitCode;
}

void main();
