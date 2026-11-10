import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allPassed, runChecks } from '../src/doctor.js';
import { fullSettingsFor } from './fakePingone.js';
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
    const c = (await runChecks({ env: { CAL_ENV_FILE: f } })).find((x) => x.id === 'settings-file');
    assert.equal(c.level, 'info'); assert.ok(!JSON.stringify(c).includes('hunter2'));
    fs.chmodSync(f, 0o600);
    assert.equal((await runChecks({ env: { CAL_ENV_FILE: f } })).find((x) => x.id === 'settings-file').level, 'pass');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('owner 2026-11-09: the doctor says which file it reads (the app\'s own .env by default) and lists missing Live settings by name, never a value', async () => {
  const dflt = (await runChecks({ env: {} })).find((x) => x.id === 'settings-file');
  assert.match(dflt.detail, /reads \S+\/\.env \(this app's \.env beside docker-compose\.yml\)/); assert.doesNotMatch(dflt.detail, new RegExp(['Develop' + 'ment/', 'STANDALONE' + '_ENV'].join('|')));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-doc-env-'));
  const f = path.join(dir, '.env');
  try {
    const at = async () => (await runChecks({ env: { CAL_ENV_FILE: f } })).find((x) => x.id === 'settings-file');
    const none = await at(); assert.equal(none.level, 'info'); assert.ok(none.detail.includes(`reads ${f} (CAL_ENV_FILE): not there`)); assert.match(none.detail, /copy \.env\.example to \.env/);
    fs.writeFileSync(f, 'PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_SECRET=hunter2hunter2\n', { mode: 0o600 });
    const partial = await at(); assert.equal(partial.level, 'pass'); assert.match(partial.detail, /full-Real settings missing: CAL_USER_CLIENT_ID, .*CAL_GATEWAY_SCOPE \(/); assert.doesNotMatch(partial.detail, /PINGONE_ENVIRONMENT_ID/, 'a set name is not listed');
    assert.ok(!/hunter2|11111111/.test(partial.detail), 'no value printed');
    fs.writeFileSync(f, 'PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=hunter2hunter2\n', { mode: 0o600 });
    const full = await at(); assert.match(full.detail, /full-Real settings missing: CAL_USER_CLIENT_ID/, 'the old worker client is not the full-Real settings'); assert.ok(!/hunter2|11111111|cid\b/.test(full.detail));
    fs.writeFileSync(f, `${Object.entries(fullSettingsFor('https://gw.lab-test.net/mcp')).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
    const all = await at(); assert.match(all.detail, /the full-Real settings are all set/); assert.ok(!all.detail.includes(fullSettingsFor('').CAL_USER_CLIENT_SECRET));
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

test('step 3 (option a): the live check is a pass when Real is not configured or switched off, information when a guard refuses, and a pass naming the one host when it can; no value is printed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-live-'));
  const f = path.join(dir, '.env');
  const secret = ['hunter2', 'hunter2', 'x9'].join('');
  try {
    const live = async (env) => (await runChecks({ env: { CAL_ENV_FILE: f, ...env } })).find((x) => x.id === 'live');
    fs.writeFileSync(f, '', { mode: 0o600 });
    assert.equal((await live({})).level, 'pass'); assert.match((await live({})).detail, /Real is not configured \(full Real needs PINGONE_ENVIRONMENT_ID, CAL_USER_CLIENT_ID.*\): Mock only/);
    fs.writeFileSync(f, `PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=${secret}\n`, { mode: 0o600 });
    const off = await live({ CAL_ALLOW_LIVE: '0' }); assert.equal(off.level, 'pass'); assert.match(off.detail, /switched off \(CAL_ALLOW_LIVE=0\)/);
    const refused = await live({ IDP: 'mock' }); assert.equal(refused.level, 'info'); assert.match(refused.detail, /Real \(identity provider only\) is configured but refused: Real is off: IDP is pinned to mock/);
    assert.equal((await live({})).level, 'pass', 'complete settings and no opt-in: Real is on');
    const ok = await live({ CAL_ALLOW_LIVE: '1', IDP: 'pingone' });
    assert.equal(ok.level, 'pass'); assert.match(ok.detail, /only to https:\/\/auth\.pingone\.com;/);
    assert.match((await live({})).detail, /Real, identity provider only \(the old worker client.*\): two calls, only to https:\/\/auth\.pingone\.com;/);
    fs.writeFileSync(f, `${Object.entries(fullSettingsFor('https://gw.lab-test.net/mcp')).map(([k, v]) => `${k}=${v}`).join('\n')}\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=${secret}\n`, { mode: 0o600 });
    const fullOn = await live({}); assert.equal(fullOn.level, 'pass'); assert.match(fullOn.detail, /full Real is on: .*at https:\/\/auth\.pingone\.com, MCP to https:\/\/gw\.lab-test\.net/);
    fs.writeFileSync(f, 'CAL_USER_CLIENT_ID=u1\nPINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=x\n', { mode: 0o600 });
    const part = await live({}); assert.equal(part.level, 'info'); assert.match(part.detail, /full Real is not configured yet: missing CAL_USER_CLIENT_SECRET, .*the old PINGONE_CLIENT_\* path is ignored/);
    assert.ok(!JSON.stringify(await runChecks({ env: { CAL_ENV_FILE: f, CAL_ALLOW_LIVE: '1', IDP: 'pingone' } })).match(/hunter2|11111111-2222|cid/), 'no environment id, client or secret in any line');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('step 3: health says runtime offline by default and live when the lab says so', async () => {
  for (const [runtime, want] of [[undefined, 'offline'], [() => 'live', 'live']]) {
    const h = createHealth({ runChecks: async () => [{ level: 'pass' }], intervalMs: 3_600_000, ...(runtime ? { runtime } : {}) }); await h.ready;
    let body; h.router.stack[0].route.stack[0].handle({}, { set() {}, json(b) { body = b; } }); h.stop();
    assert.equal(body.schema, 'demo-health/1'); assert.equal(body.runtime, want);
  }
});
