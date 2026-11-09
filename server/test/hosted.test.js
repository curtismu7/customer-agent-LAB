// The hosted build (CAL_DEPLOY_MODE=hosted, rulebook section 6): the same image as Docker, mock only. Done means: the brain is off and refused whatever
// CAL_BRAIN_URL says (and never called), live is refused even with every live opt-in set, mock runs work behind the cluster's ingress (proxy headers),
// the Host check admits only loopback and LAB_ALLOWED_HOSTS, writes stay same-origin, and the page and /api/info carry the hosted banner.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { brainConfig, createBrain, REASONS } from '../src/brain.js';
import { deployModeFrom, isHosted, modeFrom } from '../src/config.js';
import { HOSTED_BANNER } from '../src/data.js';
import { HOSTED_LIVE_REFUSAL, liveRefusal, mockSignInRefusal } from '../src/safety.js';
import { runChecks } from '../src/doctor.js';
import { promptsFor } from '../src/routes.js';
import { get, post, put, rawHttp, run, W, withServer } from './helpers.js';

const HOSTED = { CAL_DEPLOY_MODE: 'hosted', ALLOW_MOCK_SIGNIN: '1', LAB_ALLOWED_HOSTS: 'customer-agent.lab.example' };
// Every live opt-in set: the hosted build must still refuse live.
const ALL_LIVE = { ...HOSTED, CAL_ALLOW_LIVE: '1', IDP: 'pingone', CAL_PUBLISH: 'loopback' };
const INGRESS = { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-host': 'customer-agent.lab.example', 'x-forwarded-proto': 'https', 'x-real-ip': '203.0.113.7' };

test('CAL_DEPLOY_MODE: local by default, hosted on purpose, anything else refused; hosted refuses a live opening mode', () => {
  assert.equal(deployModeFrom({}), 'local');
  assert.equal(deployModeFrom({ CAL_DEPLOY_MODE: 'hosted' }), 'hosted');
  assert.throws(() => deployModeFrom({ CAL_DEPLOY_MODE: 'cloud' }), /use local or hosted/);
  assert.equal(isHosted({ CAL_DEPLOY_MODE: 'hosted' }), true);
  assert.equal(isHosted({ MODE: 'hosted' }), false, 'a bare MODE is never read');
  assert.equal(modeFrom({ CAL_DEPLOY_MODE: 'hosted' }), 'mock');
  assert.throws(() => modeFrom({ CAL_DEPLOY_MODE: 'hosted', CAL_LAB_MODE: 'live' }), /mock only/);
  assert.equal(modeFrom({ CAL_LAB_MODE: 'live' }), 'live', 'local keeps the live opening mode');
});

test('the doctor reports the hosted build and fails on a hosted live opening mode', async () => {
  const ok = await runChecks({ env: { ...HOSTED, CALAB_BIND: '0.0.0.0', PORT: '5600', STANDALONE_ENV: '/nonexistent/.env' } });
  assert.match(ok.find((c) => c.id === 'deploy').detail, /hosted build/);
  const bad = await runChecks({ env: { ...HOSTED, CAL_LAB_MODE: 'live', STANDALONE_ENV: '/nonexistent/.env' } });
  assert.equal(bad.find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { CAL_DEPLOY_MODE: 'x', STANDALONE_ENV: '/nonexistent/.env' } })).find((c) => c.id === 'deploy').level, 'fail');
});

test('brain: hosted ignores CAL_BRAIN_URL, refuses with the hosted reason and never calls out', async () => {
  const cfg = brainConfig({ CAL_DEPLOY_MODE: 'hosted', CAL_BRAIN_URL: 'http://127.0.0.1:8090' });
  assert.deepEqual(cfg, { hosted: true });
  let calls = 0;
  const brain = createBrain({ config: cfg, fetchImpl: async () => { calls += 1; return new Response('{}'); } });
  assert.equal(brain.configured(), false);
  assert.equal(brain.label(), null);
  assert.deepEqual(await brain.status(), { available: false, reason: 'hosted' });
  assert.deepEqual(await brain.pick('show my balance', promptsFor('banking')), { ok: false, reason: 'hosted' });
  assert.equal(calls, 0);
  await withServer(async (url) => {
    const r = await (await get(url, '/api/brain?check=1')).json();
    assert.equal(r.configured, false); assert.equal(r.reason, 'hosted'); assert.equal(r.message, REASONS.hosted);
    const p = await (await post(url, '/api/brain/pick', { vertical: 'banking', text: 'show my balance' })).json();
    assert.deepEqual(p, { ok: false, reason: 'hosted', message: REASONS.hosted });
  }, { env: HOSTED, brain, bind: '0.0.0.0' });
  assert.equal(calls, 0);
});

test('live: refused in the hosted build even with every live opt-in set (guard, PUT /mode, POST /mode, a live run)', async () => {
  assert.equal(liveRefusal({ env: ALL_LIVE, bind: '127.0.0.1', headers: {} }), HOSTED_LIVE_REFUSAL);
  assert.equal(liveRefusal({ env: { ...ALL_LIVE, CAL_DEPLOY_MODE: undefined }, bind: '127.0.0.1', headers: {} }), null, 'local with the opt-ins allows live');
  await withServer(async (url) => {
    const info = await (await get(url, '/api/info')).json();
    assert.equal(info.realAvailable, false); assert.equal(info.guards.live, 'refused');
    const m = await put(url, '/api/mode', { mode: 'live' }, W('w-host1'));
    assert.equal(m.status, 403); assert.equal((await m.json()).detail, HOSTED_LIVE_REFUSAL);
    const s = await post(url, '/api/mode', { source: 'real' }, W('w-host1'));
    assert.equal(s.status, 409); assert.equal((await s.json()).message, HOSTED_LIVE_REFUSAL);
    const r = await run(url, 'UC1', { mode: 'live' }, W('w-host1'));
    assert.equal(r.status, 403); assert.equal(r.body.error, 'live_not_allowed');
  }, { env: ALL_LIVE, bind: '0.0.0.0' });
});

test('mock runs work behind the ingress in the hosted build and stay refused behind a proxy locally', async () => {
  assert.equal(mockSignInRefusal({ env: HOSTED, bind: '0.0.0.0', headers: INGRESS }), null);
  assert.match(mockSignInRefusal({ env: { ALLOW_MOCK_SIGNIN: '1' }, bind: '127.0.0.1', headers: INGRESS }), /proxy/);
  assert.match(mockSignInRefusal({ env: { CAL_DEPLOY_MODE: 'hosted' }, bind: '0.0.0.0', headers: INGRESS }), /ALLOW_MOCK_SIGNIN/, 'the opt-in still holds');
  await withServer(async (url) => {
    const r = await run(url, 'UC1', { vertical: 'banking' }, { ...W('w-host2'), ...INGRESS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.run.hops.length > 0, 'the run has hops');
    // per-visitor isolation: another workspace sees none of these runs, and its Reset leaves them alone
    assert.equal((await (await get(url, '/api/runs', W('w-host3'))).json()).count, 0);
    await post(url, '/api/reset', {}, W('w-host3'));
    assert.equal((await (await get(url, '/api/runs', W('w-host2'))).json()).count, 1);
  }, { env: HOSTED, bind: '0.0.0.0' });
});

test('host check: loopback and LAB_ALLOWED_HOSTS only; writes stay same-origin', async () => {
  await withServer(async (url) => {
    const port = new URL(url).port;
    assert.equal((await rawHttp(`${url}/api/health`, { headers: { host: 'customer-agent.lab.example' } })).status, 200);
    assert.equal((await rawHttp(`${url}/api/health`, { headers: { host: `127.0.0.1:${port}` } })).status, 200);
    assert.equal((await rawHttp(`${url}/api/health`, { headers: { host: 'attacker.example' } })).status, 403);
    assert.equal((await rawHttp(`${url}/api/health`, { headers: { host: 'customer-agent.lab.example.attacker.example' } })).status, 403);
    const cross = await post(url, '/api/reset', {}, { ...W('w-host4'), origin: 'https://attacker.example' });
    assert.equal(cross.status, 403); assert.equal((await cross.json()).error, 'cross_origin');
    const site = await post(url, '/api/reset', {}, { ...W('w-host4'), 'sec-fetch-site': 'cross-site' });
    assert.equal(site.status, 403);
  }, { env: HOSTED, bind: '0.0.0.0' });
});

test('banner: /api/info and the served page carry the hosted banner; the local build serves the page unchanged', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-hosted-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
  try {
    await withServer(async (url) => {
      const info = await (await get(url, '/api/info')).json();
      assert.equal(info.hosted, true); assert.equal(info.hostedBanner, HOSTED_BANNER);
      assert.match(HOSTED_BANNER, /^HOSTED AND SIMULATED/);
      for (const p of ['/', '/index.html', '/some/page']) {
        const r = await get(url, p);
        assert.equal(r.status, 200, p);
        const html = await r.text();
        assert.match(html, /<div id="root"><p class="banner" role="note" data-state="hosted" data-testid="banner">HOSTED AND SIMULATED/, p);
      }
    }, { env: HOSTED, bind: '0.0.0.0', webDist: dist });
    await withServer(async (url) => {
      const info = await (await get(url, '/api/info')).json();
      assert.equal(info.hosted, false); assert.equal(info.hostedBanner, null);
      assert.doesNotMatch(await (await get(url, '/')).text(), /HOSTED AND SIMULATED/);
    }, { webDist: dist });
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});
