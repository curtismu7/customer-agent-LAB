import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveRefused, MAX_IN_FLIGHT, assertAllowed, createLive, hostToAllow, liveConfig } from '../src/live.js';
import { findUseCase } from '../src/manifest.js';
import { CLIENT_ID, CLIENT_SECRET, ENV_ID, FAKE_TOKEN, settingsFor, startFakePingOne } from './fakePingone.js';

const uc = findUseCase('UC1');
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const withFake = async (opts, fn) => {
  const fake = await startFakePingOne(opts);
  try { await fn(fake, createLive({ config: liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: fake.base }), ...(opts?.live || {}) })); } finally { await fake.close(); }
};
const BASE = `https://auth.pingone.com/${ENV_ID}`;

test('liveConfig: the real base is https://auth.pingone.<tld>/<environment id>; a missing or invalid setting is a fixed-words problem that never carries a value', () => {
  assert.equal(liveConfig(settingsFor(), {}).base, BASE);
  for (const [region, tld] of [['NA', 'com'], ['eu', 'eu'], ['CA', 'ca'], ['AP', 'asia'], ['asia', 'asia'], [undefined, 'com']]) assert.equal(liveConfig({ ...settingsFor(), PINGONE_REGION: region }, {}).base, `https://auth.pingone.${tld}/${ENV_ID}`, String(region));
  for (const [k, v] of [['PINGONE_ENVIRONMENT_ID', 'not-a-uuid'], ['PINGONE_ENVIRONMENT_ID', undefined], ['PINGONE_REGION', 'mars'], ['PINGONE_CLIENT_ID', undefined], ['PINGONE_CLIENT_ID', 'a\nb'], ['PINGONE_CLIENT_SECRET', undefined], ['PINGONE_CLIENT_SECRET', 'x'.repeat(513)]]) {
    const c = liveConfig({ ...settingsFor(), [k]: v }, {});
    assert.ok(c.problem, `${k}=${String(v).slice(0, 10)}`); assert.equal(c.base, undefined);
    assert.ok(!JSON.stringify(c).includes(CLIENT_SECRET) && !JSON.stringify(c).includes(CLIENT_ID), 'a problem never carries a value');
  }
  assert.ok(liveConfig({}, {}).problem);
});

test('liveConfig: the test base is accepted only as http on a loopback host with the environment id as its whole path', () => {
  assert.equal(liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: `http://127.0.0.1:5999/${ENV_ID}` }).base, `http://127.0.0.1:5999/${ENV_ID}`);
  assert.equal(liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: `http://localhost:5999/${ENV_ID}/` }).base, `http://localhost:5999/${ENV_ID}`);
  for (const bad of [`https://127.0.0.1:5999/${ENV_ID}`, `http://auth.pingone.com/${ENV_ID}`, `http://127.0.0.1:5999/other`, `http://127.0.0.1:5999/${ENV_ID}/x`, `http://u:p@127.0.0.1:5999/${ENV_ID}`, 'nonsense', `http://192.0.2.1/${ENV_ID}`]) {
    assert.ok(liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: bad }).problem, bad);
  }
});

test('assertAllowed: the configured origin and the two fixed paths only; https only (http on loopback); no credentials, query or fragment; no other host, path or environment', () => {
  const ok = [`${BASE}/as/token`, `${BASE}/as/.well-known/openid-configuration`];
  for (const u of ok) assert.equal(assertAllowed(u, BASE).href, u);
  const other = '22222222-2222-4222-8222-222222222222';
  for (const bad of [
    'https://evil.example/as/token', `https://auth.pingone.com.evil.example/${ENV_ID}/as/token`, `https://auth.pingone.eu/${ENV_ID}/as/token`, `http://auth.pingone.com/${ENV_ID}/as/token`,
    `https://u:p@auth.pingone.com/${ENV_ID}/as/token`, `${BASE}/as/token?x=1`, `${BASE}/as/token#f`, `${BASE}/as/authorize`, `${BASE}/../${other}/as/token`, `https://auth.pingone.com/${other}/as/token`, `${BASE}/as/token/`, 'not a url', `${BASE}/as/TOKEN`,
  ]) assert.throws(() => assertAllowed(bad, BASE), (e) => e instanceof LiveRefused, bad);
  assert.equal(assertAllowed('http://127.0.0.1:5999/x/as/token', 'http://127.0.0.1:5999/x').pathname, '/x/as/token');
  assert.throws(() => assertAllowed('http://127.0.0.1:5998/x/as/token', 'http://127.0.0.1:5999/x'), LiveRefused, 'a different loopback port is another origin');
  assert.throws(() => assertAllowed('http://example.com/x/as/token', 'http://example.com/x'), LiveRefused, 'http is refused off loopback');
});

test('a live run makes exactly two calls to the fake, with the right method, path, Basic credentials and a traceparent that matches the hop; the secret and the raw token never appear in the run', async () => {
  await withFake({}, async (fake, live) => {
    const run = await live.run(uc, { vertical: 'banking', traceparent: TP });
    assert.deepEqual(fake.seen.map((s) => `${s.method} ${s.url}`), [`GET /${ENV_ID}/as/.well-known/openid-configuration`, `POST /${ENV_ID}/as/token`]);
    assert.equal(fake.seen[1].headers.authorization, `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`);
    assert.equal(fake.seen[1].body, 'grant_type=client_credentials');
    assert.equal(fake.seen[0].headers.authorization, undefined, 'the public discovery call carries no credential');
    for (const [i, h] of run.hops.entries()) { assert.equal(fake.seen[i].headers.traceparent, h.traceparent); assert.ok(h.traceparent.startsWith(`00-${run.traceId}-`)); }
    assert.equal(run.traceId, '0af7651916cd43dd8448eb211c80319c', 'the browser\'s trace is continued');
    assert.equal(run.outcome, 'LIVE_OK'); assert.equal(run.mode, 'live'); assert.equal(run.kind, 'live'); assert.equal(run.computed, false); assert.equal(run.matchesExpected, null); assert.equal(run.persona, null);
    assert.deepEqual(run.hops.map((h) => [h.kind, h.verdict, h.mock, h.live]), [['live-discovery', 'ok', false, true], ['live-actor-token', 'ok', false, true]]);
    assert.match(run.hops[0].note, /advertises the RFC 8693/);
    assert.deepEqual(Object.keys(run.hops[0].response.body).sort(), ['grant_types_supported', 'issuer', 'token_endpoint', 'token_endpoint_auth_methods_supported'], 'only the listed discovery fields are shown');
    assert.equal(run.tokens.length, 1); assert.equal(run.tokens[0].mock, false);
    assert.equal(run.tokens[0].raw, `${FAKE_TOKEN.slice(0, 6)}...${FAKE_TOKEN.slice(-4)}`); assert.equal(run.tokens[0].claims.client_id, CLIENT_ID); assert.equal(run.tokens[0].header.alg, 'RS256');
    assert.deepEqual(run.notRun.steps, uc.evidence.tokenChain); assert.match(run.notRun.reason, /identity provider only/);
    const text = JSON.stringify(run);
    for (const secret of [CLIENT_SECRET, FAKE_TOKEN, FAKE_TOKEN.split('.')[2], Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'), 'dropped']) assert.ok(!text.includes(secret), 'nothing secret or unlisted in the run');
    assert.match(run.hops[1].request.headers.authorization, /write-only/);
  });
});

test('failures are hops with a verdict, not exceptions: a wrong secret, a 500, a redirect (never followed), a huge reply, an HTML reply, a timeout, no listener', async () => {
  const cases = [
    ['bad-secret', 'LIVE_REFUSED', (r) => { assert.equal(r.hops[1].verdict, 'deny'); assert.equal(r.hops[1].response.status, 401); assert.equal(r.hops[1].response.body.error, 'invalid_client'); assert.equal(r.tokens.length, 0); assert.equal(r.hops[0].verdict, 'ok'); }],
    ['redirect', 'LIVE_REFUSED', (r) => { assert.match(r.hops[0].note, /redirect; the lab never follows/); assert.equal(r.hops[1].verdict, 'deny'); }],
    ['huge', 'LIVE_REFUSED', (r) => { assert.match(r.hops[0].note, /larger than the lab reads/); assert.equal(r.tokens.length, 0); }],
    ['html', 'LIVE_REFUSED', (r) => { assert.equal(r.hops[0].verdict, 'deny'); assert.equal(r.hops[0].response.body.note, 'the reply was not a JSON object'); }],
  ];
  for (const [behaviour, outcome, check] of cases) {
    await withFake({ behaviour }, async (fake, live) => {
      const r = await live.run(uc, { vertical: 'banking', traceparent: TP });
      assert.equal(r.outcome, outcome, behaviour); check(r);
      assert.ok(!fake.seen.some((s) => s.url.includes('never-followed')), 'a redirect is not followed');
      assert.ok(!JSON.stringify(r).includes(CLIENT_SECRET));
    });
  }
  await withFake({ behaviour: 'discovery-500' }, async (_f, live) => {
    const r = await live.run(uc, { vertical: 'banking', traceparent: TP });
    assert.equal(r.outcome, 'LIVE_REFUSED', 'a refused discovery fails the run even though the token call works'); assert.equal(r.hops[0].response.status, 500); assert.equal(r.hops[0].verdict, 'deny'); assert.equal(r.hops[1].verdict, 'ok');
  });
  await withFake({ behaviour: 'slow', delayMs: 400, live: { timeoutMs: 60 } }, async (_fake, live) => {
    const r = await live.run(uc, { vertical: 'banking', traceparent: TP });
    assert.equal(r.outcome, 'LIVE_UNREACHABLE'); assert.deepEqual(r.hops.map((h) => h.response.status), [0, 0]); assert.match(r.hops[0].note, /did not answer/);
  });
  const fake = await startFakePingOne(); const base = fake.base; await fake.close();
  const dead = createLive({ config: liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: base }) });
  assert.equal((await dead.run(uc, { vertical: 'banking', traceparent: TP })).outcome, 'LIVE_UNREACHABLE');
});

test('an opaque (non-JWT) token is masked and says there is nothing to decode', async () => {
  await withFake({ behaviour: 'opaque' }, async (_f, live) => {
    const r = await live.run(uc, { vertical: 'banking', traceparent: TP });
    assert.equal(r.outcome, 'LIVE_OK'); assert.equal(r.tokens[0].raw, 'opaque...cdef'); assert.equal(r.tokens[0].header, null); assert.match(r.tokens[0].claims.note, /opaque/);
  });
});

test('an unconfigured live refuses (not_configured) and makes no call; a third parallel run is refused as busy and the slot is freed afterwards', async () => {
  const none = createLive();
  assert.equal(none.configured(), false); assert.equal(none.origin(), null);
  await assert.rejects(none.run(uc, { vertical: 'banking', traceparent: TP }), (e) => e instanceof LiveRefused && e.code === 'not_configured');
  await withFake({ delayMs: 150 }, async (fake, live) => {
    const runs = Array.from({ length: MAX_IN_FLIGHT + 1 }, () => live.run(uc, { vertical: 'banking', traceparent: TP }).then((r) => r.outcome, (e) => e.code));
    const got = await Promise.all(runs);
    assert.deepEqual(got.filter((g) => g === 'busy').length, 1); assert.equal(got.filter((g) => g === 'LIVE_OK').length, MAX_IN_FLIGHT);
    assert.equal((await live.run(uc, { vertical: 'banking', traceparent: TP })).outcome, 'LIVE_OK', 'the slots are free again');
    assert.equal(fake.seen.length, 2 * (MAX_IN_FLIGHT + 1), 'the refused run made no call');
  });
});

test('the origin is the host only: no environment id, no client', async () => {
  const live = createLive({ config: liveConfig(settingsFor(), {}) });
  assert.equal(live.origin(), 'https://auth.pingone.com'); assert.ok(!live.origin().includes(ENV_ID));
});

test('hostToAllow: the netguard is told the PingOne host only when live is configured and the opt-in holds; never for a refusal, no settings or a loopback fake', () => {
  const real = createLive({ config: liveConfig(settingsFor(), {}) });
  assert.equal(hostToAllow(real, null), 'auth.pingone.com');
  assert.equal(hostToAllow(real, 'Live mode is off.'), null, 'a refused guard allows nothing');
  assert.equal(hostToAllow(createLive(), null), null, 'unconfigured allows nothing');
  assert.equal(hostToAllow(createLive({ config: liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: `http://127.0.0.1:5999/${ENV_ID}` }) }), null), null, 'a loopback fake needs no allowance');
  assert.equal(hostToAllow(createLive({ config: liveConfig({ ...settingsFor(), PINGONE_REGION: 'eu' }, {}) }), null), 'auth.pingone.eu');
});
