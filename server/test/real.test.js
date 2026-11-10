// Full Real (owner, 2026-11-10) against FAKES only: the fake PingOne (pi.flow, flows API, resume, code, client credentials, token exchange with act)
// and the fake Agent Gateway (MCP). Nothing here reaches a real PingOne or SE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReal, realConfig, assertAuthUrl, REDIRECT_URI, PASSWORD_SHOWN } from '../src/real.js';
import { createLive, liveConfig } from '../src/live.js';
import { gatewayHeaders, TRUSTED_HEADERS, SENT_HEADERS, assertNoTrusted, parseAuditTrail, parseRpc, gatewayUrlProblem } from '../src/mcpClient.js';
import { realGate, SE_MCP_TOOLS } from '../src/realGate.js';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { loadCast } from '../src/cast.js';
import { installNetguard } from '../src/netguard.js';
import { fullWanted, missingFull, FULL_KEYS } from '../src/settings.js';
import { get, post, run, W, withServer } from './helpers.js';
import { AGENT_CLIENT_SECRET, CLIENT_SECRET, DEMO_PASSWORD, DEMO_USERNAME, ENV_ID, USER_CLIENT_SECRET, fullSettingsFor, settingsFor, startFakePingOne } from './fakePingone.js';
import { AUDIT_TRAIL, startFakeGateway } from './fakeGateway.js';

const ENV = { ALLOW_MOCK_SIGNIN: '1' };
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
// Starts both fakes and a lab with full Real; fn(url, { p1, gw, real }).
async function withFull(fn, { signin = 'ok', exchange = 'ok', gateway = 'ok', env = ENV } = {}) {
  const p1 = await startFakePingOne();
  p1.state.full = { signin, exchange };
  const gw = await startFakeGateway({ behaviour: gateway, isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url), { CAL_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  try { await withServer((url) => fn(url, { p1, gw, real }), { env, real }); } finally { await p1.close(); await gw.close(); }
}
const toReal = (url, h = {}) => post(url, '/api/mode', { source: 'real' }, h);
const signIn = async (url, password = DEMO_PASSWORD, h = {}) => { const r = await post(url, '/api/signin', { password }, h); return { status: r.status, text: await r.clone().text(), body: await r.json() }; };
const SECRETS = [DEMO_PASSWORD, USER_CLIENT_SECRET, AGENT_CLIENT_SECRET, CLIENT_SECRET];
const noSecret = (text, what) => { for (const s of SECRETS) assert.ok(!text.includes(s), `${what} carries a secret or the password`); };

test('the full chain: pi.flow sign-in, agent token, token exchange with act, gateway initialize + tools/list + tools/call, a real reply; every hop REAL', async () => {
  await withFull(async (url, { p1, gw }) => {
    assert.equal((await toReal(url)).status, 200);
    const pre = await (await get(url, '/api/signin')).json();
    assert.deepEqual([pre.available, pre.signedIn, pre.username, pre.method, pre.redirect], [true, false, DEMO_USERNAME, 'pi.flow', false]);
    const s = await signIn(url);
    assert.equal(s.status, 200); assert.equal(s.body.signedIn, true); assert.equal(s.body.user.name, DEMO_USERNAME);
    const auth = p1.seen.find((x) => x.url.includes('/as/authorize'));
    const q = new URL(auth.url, 'http://x').searchParams;
    assert.equal(q.get('response_mode'), 'pi.flow'); assert.equal(q.get('code_challenge_method'), 'S256'); assert.equal(q.get('redirect_uri'), REDIRECT_URI);
    assert.equal(q.get('scope'), 'openid profile email fake:mcp:invoke', 'the OIDC scopes plus the gateway scope'); assert.equal(REDIRECT_URI, 'http://127.0.0.1:5603/callback', 'one of the URIs the owner setup script registers');
    const r = await run(url, 'UC1', { vertical: 'banking' }, { traceparent: TP });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const x = r.body.run;
    assert.equal(x.kind, 'real'); assert.equal(x.outcome, 'REAL_PERMIT'); assert.equal(x.reply.who, 'Agent'); assert.match(x.reply.text, /balance 1200\.5/);
    assert.deepEqual(x.hops.map((h) => h.kind), ['sign-in', 'actor-token', 'token-exchange', 'gateway-check', 'authorize-decision', 'tool-dispatched', 'api-call', 'agent-reply']);
    assert.ok(x.hops.every((h) => h.source === 'real' && h.mock === false && /\[REAL\]/.test(h.label)), 'every hop ran for real and says so');
    assert.equal(x.traceparent.split('-')[1], TP.split('-')[1]);
    const delegated = x.tokens.find((t) => /delegated/.test(t.label));
    assert.ok(delegated && delegated.real && delegated.raw.split('.').length === 3, 'the delegated token is shown raw');
    assert.deepEqual(delegated.claims.act, { sub: fullSettingsFor('').CAL_AGENT_CLIENT_ID }); assert.equal(delegated.claims.aud, 'fake-gateway-audience');
    const methods = gw.seen.map((c) => c.rpc.method);
    assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'tools/call']);
    assert.deepEqual(gw.seen.slice(3).map((c) => c.rpc.params.name), ['get_my_accounts', 'get_account_balance']);
    assert.equal(gw.seen[4].rpc.params.arguments.account_id, 'acct-fake-1');
    for (const c of gw.seen) {
      assert.equal(c.headers['x-token-validation'], 'jwks'); assert.equal(c.headers['x-active-vertical'], 'banking'); assert.match(c.headers.traceparent, /^00-0af7651916cd43dd8448eb211c80319c-/);
      assert.ok(p1.issued.delegated.has(c.headers.authorization.slice(7)), 'the bearer is the delegated token');
    }
    assert.ok(gw.seen.slice(1).every((c) => c.headers['mcp-session-id'] === 'fake-mcp-session-0001'), 'Mcp-Session-Id after initialize');
    noSecret(JSON.stringify(r.body) + s.text, 'the run or the sign-in answer');
    assert.ok(!JSON.stringify(r.body).includes('fake-refresh-never-shown'), 'the refresh token is dropped');
  });
});

test('no trusted-caller header is ever sent, and the client refuses to build one', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    await run(url, 'UC1', { vertical: 'banking' }, { 'x-demo-force-actor': 'rogue', 'x-internal-gateway-secret': 'x', 'x-act-client-id': 'y', 'x-may-act-sub': 'z', 'x-authz-simulated': '1' });
    assert.ok(gw.seen.length >= 3);
    for (const c of gw.seen) {
      for (const h of TRUSTED_HEADERS) assert.equal(c.headers[h], undefined, `${h} reached the gateway`);
      for (const h of Object.keys(c.headers)) assert.ok([...SENT_HEADERS, 'host', 'connection', 'content-length', 'accept-encoding', 'accept-language', 'sec-fetch-mode', 'user-agent'].includes(h), `unexpected header ${h}`);
    }
  });
  assert.deepEqual(TRUSTED_HEADERS, ['x-internal-gateway-secret', 'x-authz-simulated', 'x-act-client-id', 'x-may-act-sub', 'x-demo-force-actor']);
  for (const h of TRUSTED_HEADERS) assert.throws(() => assertNoTrusted({ [h.toUpperCase()]: 'x' }), /trusted-caller/);
  assert.throws(() => assertNoTrusted({ 'x-other': '1' }), /Only the listed/);
  assert.deepEqual(Object.keys(gatewayHeaders({ token: 't', traceparent: TP, vertical: 'banking' })).sort(), ['accept', 'authorization', 'content-type', 'traceparent', 'x-active-vertical', 'x-token-validation']);
});

test('error mapping: 403 DENY with the audit trail, 401 token problem with WWW-Authenticate, 428 held (approval simulated), 503 SE down, tool error, tool not listed; never retried', async () => {
  const cases = [
    ['deny', 'REAL_DENY', 'Authorize', /denied this request \(HTTP 403.*decision DENY/],
    ['token', 'REAL_TOKEN_PROBLEM', 'Gateway', /HTTP 401.*invalid_token/],
    ['hold', 'REAL_HOLD', 'Authorize', null],
    ['down', 'REAL_UNREACHABLE', 'Gateway', /SE is down or scaled down/],
    ['tool-error', 'REAL_TOOL_ERROR', 'Agent', /answered with an error: fake: the account was not found/],
    ['no-tool', 'REAL_NOT_LISTED', 'Gateway', /does not list the tool get_account_balance/],
  ];
  for (const [behaviour, outcome, who, text] of cases) {
    await withFull(async (url, { gw }) => {
      await toReal(url); await signIn(url);
      const r = await run(url, 'UC1', { vertical: 'banking' });
      assert.equal(r.status, 200, behaviour); const x = r.body.run;
      assert.equal(x.outcome, outcome, behaviour); assert.equal(x.reply.who, who, behaviour);
      if (text) assert.match(x.reply.text, text, behaviour);
      assert.equal(x.hops.length, 8, `${behaviour}: always the eight hops`);
      assert.ok(x.hops.every((h) => (h.source === 'real') === (h.verdict !== 'skip')), `${behaviour}: a hop that did not run says NOT RUN, never REAL`);
      if (behaviour === 'deny') {
        const d = x.hops.find((h) => h.kind === 'authorize-decision');
        assert.equal(d.decision.outcome, 'DENY'); assert.deepEqual(d.response['x-gw-audit-trail'], JSON.parse(AUDIT_TRAIL));
      }
      if (behaviour === 'token') assert.match(x.hops.find((h) => h.kind === 'gateway-check').note, /WWW-Authenticate: Bearer error="invalid_token"/);
      if (behaviour === 'hold') { assert.equal(x.reply.approval.head, 'Held for approval (REAL)'); assert.match(x.reply.approval.body, /approval is simulated/); assert.equal(x.hops.find((h) => h.kind === 'tool-held').verdict, 'held'); }
      const calls = gw.seen.filter((c) => c.rpc.method === 'initialize').length;
      assert.equal(calls, 1, `${behaviour}: initialize once, no retry loop`);
    }, { gateway: behaviour });
  }
});

test('a gateway that does not answer at all (connect error) is SE down, with one attempt', async () => {
  const p1 = await startFakePingOne();
  const real = createReal({ config: realConfig(fullSettingsFor('http://127.0.0.1:9/mcp'), { CAL_LIVE_TEST_BASE: p1.base }), wanted: true });
  try {
    await withServer(async (url) => {
      await toReal(url); await signIn(url);
      const r = await run(url, 'UC1', { vertical: 'banking' });
      assert.equal(r.body.run.outcome, 'REAL_UNREACHABLE'); assert.match(r.body.run.reply.text, /SE is down or scaled down.*did not answer.*Switch to Mock/);
    }, { env: ENV, real });
  } finally { await p1.close(); }
});

test('PingOne refusals: wrong password 401, an MFA step 409, refused exchange, no act claim noted; the password never appears', async () => {
  await withFull(async (url) => {
    await toReal(url);
    const s = await signIn(url, 'not-the-password-123');
    assert.equal(s.status, 401); assert.equal(s.body.error, 'signin_rejected'); assert.match(s.body.message, /did not accept the username or password/);
    assert.ok(!s.text.includes('not-the-password-123'), 'a wrong password is not echoed');
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).status, 401, 'still not signed in');
  });
  await withFull(async (url) => {
    await toReal(url);
    const s = await signIn(url); assert.equal(s.status, 409); assert.equal(s.body.error, 'signin_step_unsupported');
  }, { signin: 'mfa' });
  await withFull(async (url) => {
    await toReal(url); assert.equal((await signIn(url)).status, 200, 'resume path');
    const r = await run(url, 'UC1', { vertical: 'banking' }); assert.equal(r.body.run.outcome, 'REAL_PERMIT');
  }, { signin: 'resume' });
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.body.run.outcome, 'REAL_REFUSED'); assert.equal(r.body.run.reply.who, 'PingOne'); assert.equal(gw.seen.length, 0);
  }, { exchange: 'refuse' });
  await withFull(async (url) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.match(r.body.run.hops.find((h) => h.kind === 'token-exchange').note, /WITHOUT an act claim/);
  }, { exchange: 'no-act' });
});

test('the password is never logged, stored, returned or shown in a hop; the sign-in answer carries a fixed placeholder', async () => {
  const logs = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => { logs.push(a.map(String).join(' ')); };
  try {
    await withFull(async (url, { real }) => {
      await toReal(url);
      const s = await signIn(url);
      assert.equal(s.status, 200);
      const step = s.body.steps.find((x) => /username and password/.test(x.step));
      assert.equal(step.request.body.password, PASSWORD_SHOWN);
      const r = await run(url, 'UC1', { vertical: 'banking' });
      const texts = [s.text, JSON.stringify(r.body)];
      for (const p of ['/api/info', '/api/signin', '/api/runs', '/api/mode', '/api/health']) texts.push(await (await get(url, p)).text());
      noSecret(texts.join(''), 'an answer');
      const session = real.session('default');
      assert.ok(!JSON.stringify(session).includes(DEMO_PASSWORD), 'the session holds no password');
    });
  } finally { Object.assign(console, orig); }
  assert.ok(!logs.join('\n').includes(DEMO_PASSWORD), 'no log line carries the password');
});

test('sign-in input is bounded and never echoed; unknown fields refused; GET /api/signin and POST refuse when full Real is not available (409)', async () => {
  await withFull(async (url) => {
    for (const body of [{}, { password: '' }, { password: 'x'.repeat(257) }, { password: 5 }, { password: 'a', username: 'other' }]) {
      const r = await post(url, '/api/signin', body); assert.equal(r.status, 400); assert.ok(!(await r.text()).includes('x'.repeat(50)));
    }
  });
  await withServer(async (url) => {
    const g = await (await get(url, '/api/signin')).json(); assert.equal(g.available, false); assert.equal(g.username, null); assert.match(g.reason, /CAL_USER_CLIENT_ID/);
    const r = await post(url, '/api/signin', { password: 'whatever-1' }); assert.equal(r.status, 409);
  }, { env: ENV });
});

test('rule 19: not configured = Real disabled with the missing names, POST /api/mode 409; toggle both ways without a restart; Reset ends the sign-in', async () => {
  await withServer(async (url) => {
    const info = await (await get(url, '/api/info')).json();
    assert.equal(info.realAvailable, false); assert.equal(info.real.level, null);
    assert.deepEqual(info.real.missing, ['PINGONE_ENVIRONMENT_ID', ...FULL_KEYS]);
    const r = await toReal(url); assert.equal(r.status, 409); assert.match((await r.json()).message, /fill PINGONE_ENVIRONMENT_ID, CAL_USER_CLIENT_ID/);
  }, { env: ENV, real: createReal({ missing: missingFull({}), wanted: false }) });
  await withFull(async (url) => {
    const info = await (await get(url, '/api/info')).json();
    assert.equal(info.realAvailable, true); assert.equal(info.real.level, 'full'); assert.deepEqual(info.real.missing, []); assert.equal(info.real.redirectUri, REDIRECT_URI);
    for (const src of ['real', 'mock', 'real', 'mock']) {
      assert.equal((await post(url, '/api/mode', { source: src })).status, 200);
      assert.equal((await (await get(url, '/api/info')).json()).source, src);
    }
    await toReal(url); await signIn(url);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).body.run.kind, 'real');
    await post(url, '/api/mode', { source: 'mock' });
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).body.run.mode, 'mock', 'back to Mock without a restart');
    await post(url, '/api/reset', {});
    assert.equal((await (await get(url, '/api/signin')).json()).signedIn, false, 'Reset signs the workspace out');
    await toReal(url);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).status, 401);
  });
});

test('sign-in is per workspace; sign-out works', async () => {
  await withFull(async (url) => {
    await toReal(url, W('ws-a')); await toReal(url, W('ws-b'));
    await signIn(url, DEMO_PASSWORD, W('ws-a'));
    assert.equal((await run(url, 'UC1', { vertical: 'banking' }, W('ws-a'))).status, 200);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' }, W('ws-b'))).status, 401);
    await post(url, '/api/signout', {}, W('ws-a'));
    assert.equal((await run(url, 'UC1', { vertical: 'banking' }, W('ws-a'))).status, 401);
  });
});

test('use-case gating: only SE mcp-server tools run Real; the rest run Mock in Real mode, every hop MOCK with the reason, with no sign-in needed', async () => {
  const cast = loadCast('/nonexistent', 'banking');
  const realIds = MANIFEST.usecases.filter((u) => realGate(u, cast).real).map((u) => u.id);
  assert.deepEqual(realIds, ['UC1', 'UC3', 'UC19', 'UC20', 'UC4', 'UC6', 'UC24', 'UC17', 'UC28']);
  const why = (id) => realGate(findUseCase(id), cast).reason;
  assert.match(why('UC13'), /trusted-caller/); assert.match(why('UC18'), /trusted-caller/); assert.match(why('UC21'), /tiers/);
  assert.match(why('UC8'), /approval/); assert.match(why('UC22'), /approval/); assert.match(why('UC2'), /A2A/); assert.match(why('UC33'), /scaled to 0/);
  assert.match(why('UC40'), /Privilege|ID-JAG/); assert.match(why('UC-TOOL1'), /code-search/); assert.match(why('UC9'), /feature flag/);
  for (const id of realIds) assert.ok(SE_MCP_TOOLS.has(realGate(findUseCase(id), cast).tool));
  await withFull(async (url, { gw }) => {
    await toReal(url);
    const r = await run(url, 'UC2', { vertical: 'banking' });
    assert.equal(r.status, 200); assert.equal(r.body.run.mode, 'mock'); assert.equal(r.body.run.realGate.real, false);
    assert.ok(r.body.run.hops.filter((h) => h.verdict !== 'skip').every((h) => h.source === 'mock' && /\[MOCK\]/.test(h.label) && /^MOCK in Real mode: agent-to-agent/.test(h.note)));
    assert.equal(gw.seen.length, 0, 'a Mock use case never calls the gateway');
    const list = await (await get(url, '/api/usecases?vertical=banking')).json();
    const uc1 = list.tracks.flatMap((t) => t.usecases).find((u) => u.id === 'UC1'); assert.equal(uc1.realGate.real, true);
  });
});

test('the old two-call path only while the new settings are absent, labelled identity provider only; any CAL_* setting turns it off', async () => {
  const fake = await startFakePingOne();
  try {
    const live = createLive({ config: liveConfig(settingsFor(), { CAL_LIVE_TEST_BASE: fake.base }) });
    await withServer(async (url) => {
      const info = await (await get(url, '/api/info')).json();
      assert.equal(info.real.level, 'idp-only'); assert.match(info.real.label, /identity provider only/); assert.ok(info.real.missing.includes('CAL_USER_CLIENT_ID'));
      assert.equal((await toReal(url)).status, 200);
      const r = await run(url, 'UC1', { vertical: 'banking' });
      assert.equal(r.body.run.kind, 'live'); assert.equal(r.body.run.real.level, 'idp-only'); assert.equal(fake.seen.length, 2);
      assert.ok(r.body.run.hops.every((h) => h.source === 'real' && /identity provider only \[REAL\]/.test(h.label)));
    }, { env: ENV, live, real: createReal({ missing: missingFull(settingsFor()), wanted: false }) });
    // One CAL_* name set (the owner started the scripts): the old path is ignored, Real is unavailable until all are set.
    const partial = { ...settingsFor(), CAL_USER_CLIENT_ID: 'u-1' };
    assert.equal(fullWanted(partial), true); assert.equal(fullWanted(settingsFor()), false);
    await withServer(async (url) => {
      const info = await (await get(url, '/api/info')).json();
      assert.equal(info.real.level, null); assert.equal(info.realAvailable, false); assert.equal(info.liveSettings.configured, false);
      assert.ok(!info.real.missing.includes('CAL_USER_CLIENT_ID') && info.real.missing.includes('CAL_AGENT_CLIENT_SECRET'));
      assert.equal((await toReal(url)).status, 409);
      assert.equal((await run(url, 'UC1', { vertical: 'banking', mode: 'live' })).status, 503);
      assert.equal(fake.seen.length, 2, 'the worker client is never used once a CAL_* setting is there');
    }, { env: ENV, live, real: createReal({ config: realConfig(partial, {}), missing: missingFull(partial), wanted: true }) });
  } finally { await fake.close(); }
});

test('netguard per mode: Mock runs make zero attempts with full Real configured; Real reaches only the allowed hosts', async () => {
  const guard = installNetguard();
  try {
    await withFull(async (url) => {
      for (const id of ['UC1', 'UC2', 'UC6', 'UC13']) await run(url, id, { vertical: 'banking' });
      assert.deepEqual(guard.attempts, [], 'Mock: nothing left the machine');
      await toReal(url); await signIn(url); await run(url, 'UC1', { vertical: 'banking' });
      assert.deepEqual(guard.attempts, [], 'Real reached only the loopback fakes');
    });
    assert.deepEqual(guard.allowedHosts(), [], 'nothing is allowed unless index.js allows it');
  } finally { guard.restore(); }
  // The hosts index.js would allow: the auth host and the gateway host, and nothing else.
  const real = createReal({ config: realConfig({ ...fullSettingsFor('https://gw.lab-test.net/mcp'), PINGONE_REGION: 'eu' }, {}), wanted: true });
  assert.deepEqual(real.hosts(), ['auth.pingone.eu', 'gw.lab-test.net']);
});

test('config and URL guards: bad settings name the setting; PingOne calls only to the four fixed paths; gateway URL https only', () => {
  const good = fullSettingsFor('https://gw.lab-test.net/mcp');
  assert.equal(realConfig(good, {}).problem, undefined);
  for (const [k, v] of [['CAL_USER_CLIENT_ID', ''], ['CAL_AGENT_CLIENT_SECRET', 'a\nb'], ['CAL_AGENT_GATEWAY_URL', 'http://gw.lab-test.net/mcp'], ['CAL_AGENT_GATEWAY_URL', 'https://u:p@gw.lab-test.net/'], ['CAL_GATEWAY_SCOPE', 'a  b'], ['PINGONE_ENVIRONMENT_ID', 'x']]) {
    assert.match(realConfig({ ...good, [k]: v }, {}).problem, new RegExp(k), `${k}=${JSON.stringify(v)}`);
  }
  assert.equal(gatewayUrlProblem('http://127.0.0.1:5/mcp'), null, 'loopback http only for the fakes');
  const base = `https://auth.pingone.com/${ENV_ID}`;
  for (const ok of [`${base}/as/authorize?x=1`, `${base}/as/token`, `${base}/flows/abc-123`, `${base}/as/resume?flowId=a`]) assert.ok(assertAuthUrl(ok, base));
  for (const bad of [`https://evil.example/${ENV_ID}/as/token`, `${base}/as/userinfo`, `${base}/flows/../../x`, `${base}/as/token?x=1`, `http://auth.pingone.com/${ENV_ID}/as/token`, `${base}/../other/as/token`]) assert.throws(() => assertAuthUrl(bad, base), undefined, bad);
});

test('parsers: event-stream replies, audit trail JSON / base64 / text', () => {
  assert.deepEqual(parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"a":1}}\n\n', 'text/event-stream', 2), { jsonrpc: '2.0', id: 2, result: { a: 1 } });
  assert.equal(parseRpc('data: {"id":1}\n\n', 'text/event-stream', 2), null);
  assert.equal(parseAuditTrail(AUDIT_TRAIL).decision, 'DENY');
  assert.equal(parseAuditTrail(Buffer.from('{"decision":"PERMIT"}').toString('base64url')).decision, 'PERMIT');
  assert.deepEqual(parseAuditTrail('plain words'), { raw: 'plain words', parsed: null, decision: null });
});

test('an event-stream gateway works end to end', async () => {
  await withFull(async (url) => {
    await toReal(url); await signIn(url);
    assert.equal((await run(url, 'UC1', { vertical: 'healthcare' })).body.run.outcome, 'REAL_PERMIT');
  }, { gateway: 'sse' });
});
