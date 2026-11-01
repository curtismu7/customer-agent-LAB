import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allPassed, runChecks } from '../src/doctor.js';
import { createHealth } from '../src/health.js';

test('every doctor check passes on a clean default environment', async () => {
  const c = await runChecks({ env: { HOME: '/nonexistent' } });
  assert.ok(allPassed(c), JSON.stringify(c.filter((x) => x.level === 'fail')));
  for (const id of ['node', 'mode', 'bind', 'port-range', 'settings-file', 'mock-signin', 'web', 'manifest', 'steps', 'engine', 'verticals', 'story-hosts', 'story-keys', 'masking', 'mock-key', 'netguard', 'tenant']) assert.ok(c.some((x) => x.id === id), id);
  assert.match(c.find((x) => x.id === 'engine').detail, /all 87 run in mock/);
  assert.match(c.find((x) => x.id === 'engine').detail, /54 computed ones equals.*the other 33 are guided pages.*not checked/, 'the doctor line cannot be read as 87 verified');
});

test('a port outside 5600-5699 fails, and a wildcard bind needs the opt-in', async () => {
  for (const p of ['5010', '5599', '5700', '7300']) assert.equal((await runChecks({ env: { PORT: p } })).find((c) => c.id === 'port-range').level, 'fail', p);
  assert.equal((await runChecks({ env: { PORT: '5609' } })).find((c) => c.id === 'port-range').level, 'pass');
  assert.equal((await runChecks({ env: { PORT: '5609', CALAB_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
  assert.equal((await runChecks({ env: { PORT: '5609', CALAB_BIND: '' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('the mode must be mock or live; mock-signin is information, not a failure', async () => {
  assert.equal((await runChecks({ env: { CAL_LAB_MODE: 'prod' } })).find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { CAL_LAB_MODE: 'live' } })).find((c) => c.id === 'mode').level, 'pass');
  const live = (await runChecks({ env: { CAL_LAB_MODE: 'live' } })).find((c) => c.id === 'mode');
  assert.match(live.detail, /does not check or switch on the live guard/); assert.doesNotMatch(live.detail, /can be selected only/);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'mock-signin').level, 'info');
  assert.equal((await runChecks({ env: { ALLOW_MOCK_SIGNIN: '1' } })).find((c) => c.id === 'mock-signin').level, 'pass');
});

test('the settings file: absent is fine, a world-readable one is flagged, its values are never printed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-env-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, 'SECRET_THING=hunter2hunter2\n', { mode: 0o644 });
  try {
    const c = (await runChecks({ env: { STANDALONE_ENV: f } })).find((x) => x.id === 'settings-file');
    assert.equal(c.level, 'info'); assert.ok(!JSON.stringify(c).includes('hunter2'));
    fs.chmodSync(f, 0o600);
    assert.equal((await runChecks({ env: { STANDALONE_ENV: f } })).find((x) => x.id === 'settings-file').level, 'pass');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('health: unknown until the first check, ready when the checks pass, broken when one fails, unknown when the checker throws', async () => {
  const mk = (runChecks) => createHealth({ runChecks, intervalMs: 3_600_000, now: () => new Date('2026-11-01T00:00:00Z') });
  const states = [];
  for (const checks of [async () => [{ level: 'pass' }], async () => [{ level: 'fail' }], async () => { throw new Error('x'); }]) {
    const h = mk(checks); await h.ready;
    const res = { set() {}, json(b) { states.push(b.state); } };
    h.router.stack[0].route.stack[0].handle({}, res); h.stop();
  }
  assert.deepEqual(states, ['ready', 'broken', 'unknown']);
});

test('step 2: the web check is information, not a failure, when the app is not built, and passes when index.html exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-doc-'));
  try {
    const none = (await runChecks({ env: { WEB_DIST: dir } })).find((c) => c.id === 'web');
    assert.equal(none.level, 'info'); assert.match(none.detail, /npm run build/);
    fs.writeFileSync(path.join(dir, 'index.html'), '<title>x</title>');
    assert.equal((await runChecks({ env: { WEB_DIST: dir } })).find((c) => c.id === 'web').level, 'pass');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
