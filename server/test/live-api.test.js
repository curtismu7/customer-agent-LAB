import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveRefused, createLive, liveConfig } from '../src/live.js';
import { MAX_RUNS } from '../src/workspaces.js';
import { createWorkspaces } from '../src/workspaces.js';
import { get, post, put, run, W, withServer } from './helpers.js';
import { CLIENT_ID, CLIENT_SECRET, ENV_ID, FAKE_TOKEN, settingsFor, startFakePingOne } from './fakePingone.js';

const LIVE_ENV = { CAL_ALLOW_LIVE: '1', IDP: 'pingone' };
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
async function withLive(fn, { behaviour = 'ok', env = LIVE_ENV, workspaces } = {}) {
  const fake = await startFakePingOne({ behaviour });
  const live = createLive({ config: liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: fake.base }) });
  try { await withServer((url, ctx) => fn(url, { fake, ...ctx }), { env, live, ...(workspaces ? { workspaces } : {}) }); } finally { await fake.close(); }
}
const secrets = [CLIENT_SECRET, FAKE_TOKEN, FAKE_TOKEN.split('.')[2], Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')];
const noSecret = (text, what) => { for (const s of secrets) assert.ok(!text.includes(s), `${what} carries a secret`); };

test('live run over HTTP: 200 with a live run, the traceparent continued, a history row without a persona, and the fake saw exactly two calls', async () => {
  await withLive(async (url, { fake }) => {
    assert.equal((await put(url, '/api/mode', { mode: 'live' })).status, 200);
    const r = await post(url, '/api/run/UC1', { vertical: 'healthcare' }, { traceparent: TP });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.run.mode, 'live'); assert.equal(body.run.outcome, 'LIVE_OK'); assert.equal(body.run.vertical, 'healthcare'); assert.equal(body.run.persona, null);
    assert.equal(r.headers.get('traceparent').split('-')[1], '0af7651916cd43dd8448eb211c80319c'); assert.equal(body.run.tokens[0].mock, false);
    assert.equal(fake.seen.length, 2);
    const runs = await (await get(url, '/api/runs')).json();
    assert.deepEqual(runs.runs.map((x) => [x.id, x.vertical, x.persona, x.outcome, x.matchesExpected]), [['UC1', 'healthcare', null, 'LIVE_OK', null]]);
    noSecret(JSON.stringify([body, runs]), 'the run answer or the history');
  });
});

test('a live run can be asked for in the body without switching the workspace; a mock run still needs mock sign-in and is refused under IDP=pingone', async () => {
  await withLive(async (url) => {
    const live = await run(url, 'UC7', { mode: 'live' }); assert.equal(live.status, 200); assert.equal(live.body.run.mode, 'live');
    assert.equal((await (await get(url, '/api/mode')).json()).mode, 'mock', 'the workspace mode is unchanged');
    assert.equal((await run(url, 'UC7', {})).status, 403);
  }, { env: { ...LIVE_ENV, ALLOW_MOCK_SIGNIN: '1' } });
});

test('every refusal is honest and fixed text: guard 403, unconfigured 503, stub vertical 501, bad persona 400, unknown field 400, full workspace 409; a PingOne refusal is a 200 run with a deny hop', async () => {
  await withLive(async (url) => {
    assert.equal((await run(url, 'UC1', { mode: 'live', vertical: 'government' })).status, 501);
    assert.equal((await run(url, 'UC1', { mode: 'live', persona: 'root' })).status, 400);
    assert.equal((await run(url, 'UC1', { mode: 'live', extra: 1 })).status, 400);
    assert.equal((await run(url, 'NOPE', { mode: 'live' })).status, 404);
    const r = await run(url, 'UC1', { mode: 'live' }); assert.equal(r.status, 200); assert.equal(r.body.run.outcome, 'LIVE_REFUSED'); assert.equal(r.body.run.hops[1].verdict, 'deny');
    noSecret(JSON.stringify(r.body), 'a refused live run');
  }, { behaviour: 'bad-secret' });
  await withServer(async (url) => {
    const r = await run(url, 'UC1', { mode: 'live' }); assert.equal(r.status, 403); assert.equal(r.body.error, 'live_not_allowed');
  }, { env: { IDP: 'pingone' } });
});

test('a full workspace refuses a live run (409) before any call is made, and Reset frees it', async () => {
  const fake = await startFakePingOne();
  const live = createLive({ config: liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: fake.base }) });
  const workspaces = createWorkspaces();
  try {
    await withServer(async (url) => {
      for (let i = 0; i < MAX_RUNS; i += 1) await workspaces.write('default', (s) => { s.seq += 1; s.runs.push({ seq: s.seq }); });
      const r = await run(url, 'UC1', { mode: 'live' }); assert.equal(r.status, 409); assert.equal(r.body.error, 'workspace_full'); assert.equal(fake.seen.length, 0);
      await post(url, '/api/reset', {});
      assert.equal((await run(url, 'UC1', { mode: 'live' })).status, 200);
    }, { env: LIVE_ENV, live, workspaces });
  } finally { await fake.close(); }
});

test('live runs in parallel from one workspace all land in its history in order, and two workspaces do not see each other\'s', async () => {
  await withLive(async (url) => {
    const out = await Promise.all([1, 2].map(() => run(url, 'UC1', { mode: 'live' }, W('live-a'))));
    assert.deepEqual(out.map((o) => o.status), [200, 200]);
    const a = await (await get(url, '/api/runs', W('live-a'))).json(); assert.deepEqual(a.runs.map((r) => r.seq), [1, 2]);
    assert.equal((await (await get(url, '/api/runs', W('live-b'))).json()).count, 0);
  });
});

test('the secret and the raw token appear in no answer of any endpoint, with live on and configured; /api/info shows the host only', async () => {
  await withLive(async (url, { fake }) => {
    await run(url, 'UC1', { mode: 'live' });
    const texts = [];
    for (const p of ['/api/health', '/api/info', '/api/mode', '/api/runs', '/api/usecases/UC1', '/api/nope']) texts.push(await (await get(url, p)).text());
    const info = JSON.parse(texts[1]);
    assert.deepEqual(info.liveSettings, { configured: true, origin: new URL(fake.base).origin });
    noSecret(texts.join(''), 'an endpoint'); assert.ok(!texts.join('').includes(ENV_ID) && !texts.join('').includes(CLIENT_ID), 'no environment id and no client id in the lab\'s own answers');
  });
});

test('a credential typed into every field of a live run is never echoed (the API takes no free text)', async () => {
  await withLive(async (url) => {
    for (const body of [{ mode: 'live', vertical: CLIENT_SECRET }, { mode: 'live', persona: CLIENT_SECRET }, { mode: CLIENT_SECRET }, { mode: 'live', [CLIENT_SECRET]: 1 }]) {
      const r = await run(url, 'UC1', body); assert.ok(r.status >= 400); noSecret(JSON.stringify(r.body), 'a refusal');
    }
    const r = await post(url, `/api/run/${encodeURIComponent(CLIENT_SECRET)}`, { mode: 'live' }); assert.equal(r.status, 404); noSecret(await r.text(), 'a 404');
  });
});

test('the real entry point wires health: runtime is live when the opt-in holds and the settings are valid, offline otherwise', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-health-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, `${Object.entries(settingsFor()).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
  const fake = await startFakePingOne();
  const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
  const runtimeOf = async (port, extra) => {
    const env = { ...process.env, PORT: String(port), CAL_ENV_FILE: file, CAL_LIVE_TEST_BASE: fake.base, ...extra };
    for (const k of ['CALAB_BIND', 'CAL_LAB_MODE', 'ALLOW_MOCK_SIGNIN', 'IDP', 'CAL_ALLOW_LIVE']) if (!(k in extra)) delete env[k];
    const child = spawn(process.execPath, [entry], { env, stdio: 'ignore' });
    try {
      for (let i = 0; i < 200; i++) {
        try { return (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).runtime; } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      throw new Error('the lab did not start');
    } finally { child.kill(); }
  };
  try {
    assert.equal(await runtimeOf(5691, { IDP: 'pingone', CAL_ALLOW_LIVE: '1' }), 'live');
    assert.equal(await runtimeOf(5692, {}), 'offline');
    // The dormant hosted build ignores the .env: a file that would open in live (which hosted refuses to start with) still starts, mock and offline.
    const hostedFile = path.join(dir, 'hosted.env');
    fs.writeFileSync(hostedFile, `CAL_LAB_MODE=live\n${fs.readFileSync(file, 'utf8')}`, { mode: 0o600 });
    assert.equal(await runtimeOf(5694, { IDP: 'pingone', CAL_ALLOW_LIVE: '1', CAL_DEPLOY_MODE: 'hosted', CAL_ENV_FILE: hostedFile }), 'offline', 'hosted ignores the .env and its live settings');
  } finally { await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a LiveRefused that is not "busy" or "not_configured" is a 502 live_refused, not a mislabelled 503', async () => {
  const stub = { configured: () => true, problem: () => null, origin: () => 'http://127.0.0.1:1', run: async () => { throw new LiveRefused('other_origin', 'fixed text'); } };
  await withServer(async (url) => {
    const r = await run(url, 'UC1', { mode: 'live' });
    assert.equal(r.status, 502); assert.equal(r.body.error, 'live_refused');
  }, { env: LIVE_ENV, live: stub });
});
