/**
 * Starts the API for the end-to-end suite (Playwright `webServer`, TRVL-160):
 *   1. an in-memory MongoDB replica set (mongodb-memory-server from backend/node_modules),
 *   2. the reference seed and the demo seed (backend/scripts), which print the demo ids,
 *   3. the built API (`backend/dist/main.js`, run `npm run build` in backend/ first).
 * The demo ids are written to e2e/.state/demo.json for the specs. Everything stops with this process.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendEnv } from './stack.config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, '../../backend');
const stateDir = join(here, '.state');

if (!existsSync(join(backendDir, 'dist/main.js'))) {
  console.error(
    '[e2e] backend/dist/main.js is missing: run `npm run build` in backend/ first.',
  );
  process.exit(1);
}

const require = createRequire(join(backendDir, 'package.json'));
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const children = [];
let replSet;

async function shutdown(code = 0) {
  for (const child of children) child.kill();
  await replSet?.stop().catch(() => undefined);
  process.exit(code);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

/** Runs a backend npm script to completion and returns its stdout. */
function runScript(script, env) {
  return new Promise((done, fail) => {
    const child = spawn('npm', ['run', script], {
      cwd: backendDir,
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) =>
      code === 0
        ? done(out)
        : fail(new Error(`npm run ${script} exited with ${code}\n${out}`)),
    );
  });
}

/** Reads the ids that scripts/seed-demo.ts prints for Swagger. */
function parseDemoIds(output) {
  const flights = [
    ...output.matchAll(
      /flight\s+(\w+)\s+([a-f0-9]{24})\s+economy cabin\s+([a-f0-9]{24})/g,
    ),
  ].map(([, number, id, cabinId]) => ({ number, id, cabinId }));
  const hotelId = /hotel\s+.+?\s+([a-f0-9]{24})/.exec(output)?.[1];
  const rooms = [...output.matchAll(/room\s+(\w+)\s+([a-f0-9]{24})/g)].map(
    ([, number, id]) => ({
      number,
      id,
    }),
  );
  if (flights.length < 2 || !hotelId || rooms.length < 2) {
    throw new Error(
      `[e2e] could not read the demo ids from seed:demo output:\n${output}`,
    );
  }
  return { flights, hotelId, rooms };
}

try {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const env = backendEnv(replSet.getUri('travel_e2e'));

  await runScript('seed', env);
  const demo = parseDemoIds(await runScript('seed:demo', env));
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'demo.json'), JSON.stringify(demo, null, 2));

  const api = spawn(process.execPath, ['dist/main.js'], {
    cwd: backendDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(api);
  api.on('exit', (code) => {
    console.error(`[e2e] the API stopped (exit ${code})`);
    void shutdown(code ?? 1);
  });
  console.log('[e2e] API starting on', env.PORT);
} catch (error) {
  console.error(error);
  await shutdown(1);
}
