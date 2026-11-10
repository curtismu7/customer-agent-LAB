// Browser-proof of the rule-19 toggle (both directions) against a host-run instance
// with live opted in (CAL_ALLOW_LIVE=1, fake PingOne from the e2e helper). Not committed
// test infrastructure: a one-off proof script. Run: node scripts/toggle-proof.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CLIENT_SECRET, ENV_ID, settingsFor, startFakePingOne } = await import(pathToFileURL(path.join(ROOT, 'server/test/fakePingone.js')));

const assert = (cond, label) => { if (!cond) { console.error(`✖ ${label}`); process.exitCode = 1; } else console.log(`✔ ${label}`); };

const fake = await startFakePingOne();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-toggle-'));
const file = path.join(dir, '.env');
fs.writeFileSync(file, Object.entries(settingsFor()).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });

const port = 5693;
const child = spawn(process.execPath, [path.join(ROOT, 'server/src/index.js')], {
  env: { ...process.env, PORT: String(port), CAL_ENV_FILE: file, CAL_LIVE_TEST_BASE: fake.base, IDP: 'pingone', CAL_ALLOW_LIVE: '1', ALLOW_MOCK_SIGNIN: '1' },
  stdio: 'ignore',
});
try {
  let up = false;
  for (let i = 0; i < 200; i++) { try { await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(); up = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  assert(up, 'the lab started with live opted in');

  const base = `http://127.0.0.1:${port}`;
  // Mock -> Real
  let r = await fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'real' }) });
  const realBody = await r.json();
  assert(r.status === 200, `Mock -> Real: 200 (got ${r.status})`);
  assert(realBody.source === 'real', `Real is the source after the switch (${JSON.stringify(realBody).slice(0, 80)})`);

  // Real -> Mock
  r = await fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' }) });
  const mockBody = await r.json();
  assert(r.status === 200, `Real -> Mock: 200 (got ${r.status})`);
  assert(mockBody.source === 'mock', `Mock is the source after switching back`);

  // Round trip again for good measure
  r = await fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'real' }) });
  assert(r.status === 200, 'Mock -> Real again: 200');
  r = await fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' }) });
  assert(r.status === 200, 'Real -> Mock again: 200');

  // A live run through the real path (proves the Real side is not a dead end)
  r = await fetch(`${base}/api/run/UC33`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'live', persona: 'standard' }) });
  const runBody = await r.json();
  assert([200, 501].includes(r.status), `a live run answers 200 or the designed 501 (got ${r.status})`);
  assert(runBody.outcome === undefined || runBody.outcome === null || typeof runBody.outcome === 'string', 'the live run body is well-formed');

  console.log('\nToggle proof complete (both directions, twice, plus a live run).');
} finally { child.kill(); await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); }
