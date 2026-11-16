// "What Privilege did" (Rule 25): the lab's trace records, built from the mock engine's gateway hops and from a Real run against the FAKE gateway.
// Every trace passes the shared assertTrace; a real trace never says `checked`; nothing secret is in a trace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrace } from '../src/gatewayTrace.js';
import { mockExchanges, realExchanges } from '../src/gatewayExchanges.js';
import { runUseCase } from '../src/flow.js';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { loadCast, VERTICALS } from '../src/cast.js';
import { createReal, realConfig } from '../src/real.js';
import { post, run, withServer } from './helpers.js';
import { DEMO_PASSWORD, USER_CLIENT_SECRET, AGENT_CLIENT_SECRET, CLIENT_SECRET, fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { startFakeGateway } from './fakeGateway.js';

const mockRun = (id, input = {}) => runUseCase(findUseCase(id), { cast: VERTICALS.banking, vertical: 'banking', seed: 'run', ...input });
const problems = (list) => list.flatMap((e) => assertTrace(e.trace).map((p) => `${e.title}: ${p}`));

test('Mock: a run that reaches the gateway carries a trace of every call into it, each passing assertTrace, every decision computed by the simulation', () => {
  const r = mockRun('UC1');
  assert.ok(Array.isArray(r.gatewayTrace) && r.gatewayTrace.length >= 2, 'a challenge and the gateway check at least');
  assert.deepEqual(problems(r.gatewayTrace), []);
  assert.deepEqual(r.gatewayTrace.map((e) => e.step), r.gatewayTrace.map((_, i) => i + 1));
  const check = r.gatewayTrace.find((e) => /gateway-check/.test(JSON.stringify(e.title)) || e.trace.request.body?.method === 'tools/call' && e.trace.request.headers.authorization);
  assert.ok(check, 'the gateway check is traced');
  assert.equal(check.trace.source, 'mock');
  assert.ok(check.trace.decisions.length >= 3, 'signature, audience, scope, ...');
  assert.ok(check.trace.decisions.every((d) => d.basis === 'checked'), 'the simulation computed each check');
  assert.deepEqual(check.trace.decisions.map((d) => d.label).slice(0, 2), ['Signature', 'Audience']);
});

test('Mock: the request and response are the engine hop exactly, and the challenge shows no Authorization header (not one the lab did not send)', () => {
  const r = mockRun('UC1');
  const hopsInto = r.hops.filter((h) => ['tools-list-challenge', 'tools-call-challenge', 'tools-list', 'gateway-check'].includes(h.kind));
  assert.equal(r.gatewayTrace.length, hopsInto.length);
  r.gatewayTrace.forEach((e, i) => {
    const h = hopsInto[i];
    assert.deepEqual(e.trace.request.body, h.request.body);
    assert.deepEqual(e.trace.response, { status: h.response.status, headers: h.response.headers, body: h.response.body });
    assert.equal(e.trace.request.url, h.request.url);
    assert.deepEqual(Object.keys(e.trace.request.headers).sort(), Object.keys(h.request.headers).sort(), `${e.title}: exactly the headers the engine sent`);
  });
  const challenge = r.gatewayTrace.find((e) => e.status === 401);
  assert.ok(challenge && !('authorization' in challenge.trace.request.headers));
  assert.equal(challenge.trace.decisions[0].outcome, 'fail');
});

test('Mock: a refused run shows the failing check as FAIL and stops the chain there; an attack event is traced like any call', () => {
  const denied = MANIFEST.usecases.map((uc) => mockRun(uc.id)).find((r) => r.gatewayTrace?.some((e) => e.trace.decisions.some((d) => d.outcome === 'fail' && e.status !== 401)));
  assert.ok(denied, 'at least one use case is refused by a gateway check');
  const e = denied.gatewayTrace.find((x) => x.trace.decisions.some((d) => d.outcome === 'fail' && x.status !== 401));
  assert.ok(e.status >= 400);
  const fail = e.trace.decisions.at(-1);
  assert.equal(fail.outcome, 'fail', 'the failing check is the last one: nothing after it ran');
  assert.deepEqual(problems(denied.gatewayTrace), []);
});

test('Mock: every use case in the manifest builds traces that pass assertTrace; none is called Real', () => {
  let traced = 0;
  for (const uc of MANIFEST.usecases) {
    const r = mockRun(uc.id);
    assert.deepEqual(problems(r.gatewayTrace ?? []), [], uc.id);
    for (const e of r.gatewayTrace ?? []) { traced += 1; assert.equal(e.trace.source, 'mock'); assert.ok(e.trace.decisions.length > 0); }
  }
  assert.ok(traced > 50, `traced ${traced} gateway calls over the manifest`);
});

test('Mock: tools/list is not given a check the engine never ran: its one decision is read from the answer (observed)', () => {
  const r = MANIFEST.usecases.map((uc) => mockRun(uc.id)).find((x) => x.gatewayTrace?.some((e) => e.trace.request.body?.method === 'tools/list' && e.status === 200));
  const e = r.gatewayTrace.find((x) => x.trace.request.body?.method === 'tools/list' && x.status === 200);
  assert.deepEqual(e.trace.decisions.map((d) => [d.id, d.basis]), [['tools', 'observed']]);
});

test('Mock: a guided use case, which makes no gateway call, has an empty trace list or none', () => {
  const guided = MANIFEST.usecases.find((uc) => mockRun(uc.id).kind === 'guided');
  assert.ok(guided);
  assert.deepEqual(mockRun(guided.id).gatewayTrace ?? [], []);
});

test('mockExchanges leaves out skipped hops and the gateway\'s own calls onward', () => {
  const hops = [
    { kind: 'tool-dispatched', verdict: 'ok', request: { url: 'https://mcp.x.example/mcp', headers: {} }, response: { status: 200 } },
    { kind: 'gateway-check', verdict: 'skip', source: 'not-run', request: {}, response: {} },
  ];
  assert.deepEqual(mockExchanges(hops), []);
});

// ---- Real, against the fake PingOne and the fake gateway ------------------------------------------------
const SECRETS = [DEMO_PASSWORD, USER_CLIENT_SECRET, AGENT_CLIENT_SECRET, CLIENT_SECRET];
async function withReal(gateway, fn) {
  const p1 = await startFakePingOne({});
  p1.state.full = { signin: 'ok', exchange: 'ok' };
  const gw = await startFakeGateway({ behaviour: gateway, isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url, {}), { CAL_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  try {
    await withServer(async (url) => {
      await post(url, '/api/mode', { source: 'real' });
      await post(url, '/api/signin', { password: DEMO_PASSWORD });
      const r = await run(url, 'UC1', { vertical: 'banking' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      await fn(r.body.run, gw);
    }, { env: { ALLOW_MOCK_SIGNIN: '1' }, real });
  } finally { await p1.close(); await gw.close(); }
}
const delegatedOf = (x) => x.tokens.find((t) => /delegated/.test(t.label)).raw;

test('Real: a permitted run traces initialize, tools/list and tools/call with the exact JSON-RPC sent; decisions are inferred or observed, never checked', async () => {
  await withReal('ok', async (x, gw) => {
    assert.equal(x.outcome, 'REAL_PERMIT');
    assert.deepEqual(problems(x.gatewayTrace), []);
    assert.deepEqual(x.gatewayTrace.map((e) => e.title), ['initialize', 'tools/list', 'tools/call get_my_accounts', 'tools/call get_account_balance']);
    for (const e of x.gatewayTrace) {
      assert.equal(e.trace.source, 'real');
      assert.ok(e.trace.decisions.length > 0 && e.trace.decisions.every((d) => d.basis === 'inferred' || d.basis === 'observed'), `${e.title}: no checked decision`);
    }
    // The request body is what the fake gateway received, message for message.
    const posted = gw.seen.filter((s) => s.rpc && s.rpc.method !== 'notifications/initialized').map((s) => s.rpc);
    assert.deepEqual(x.gatewayTrace.map((e) => e.trace.request.body), posted);
    assert.deepEqual(x.gatewayTrace[1].trace.setup, [{ label: 'notifications/initialized', status: 202 }]);
    const list = x.gatewayTrace[1].trace;
    assert.ok(Array.isArray(list.response.body.result.tools), 'the full tools/list answer, not a summary');
    assert.match(list.decisions.find((d) => d.id === 'grant').evidence, /get_account_balance/);
  });
});

test('Real: the delegated token, the session id and every secret are absent from the traces; the bearer is shown as a length', async () => {
  await withReal('ok', async (x, gw) => {
    const text = JSON.stringify(x.gatewayTrace);
    const token = delegatedOf(x);
    assert.ok(token.length > 20);
    for (const part of [token, token.split('.')[1], ...SECRETS, 'fake-mcp-session-0001']) assert.ok(!text.includes(part), 'a secret or the session id is in a trace');
    for (const e of x.gatewayTrace) assert.match(e.trace.request.headers.authorization, new RegExp(`^Bearer <token, ${token.length} characters, kept on the server>$`));
    assert.ok(gw.seen.some((s) => String(s.headers.authorization).includes(token)), 'the real call did carry the token');
  });
});

test('Real: a gateway that echoes the bearer in its answer does not put the token in the trace', () => {
  const token = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`;
  const call = { status: 200, kind: 'ok', headers: {}, rpc: { jsonrpc: '2.0', id: 2, result: { tools: [], echo: token } }, sent: { message: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, headers: {} } };
  const out = realExchanges([{ title: 'tools/list', call }], { url: 'https://gw.example/mcp', token });
  assert.ok(!JSON.stringify(out).includes(token));
  assert.deepEqual(problems(out), []);
});

test('Real: 403 DENY is inferred for the grant and observed for the audit trail header; the refused call is the last exchange', async () => {
  await withReal('deny', async (x) => {
    assert.equal(x.outcome, 'REAL_DENY');
    assert.deepEqual(problems(x.gatewayTrace), []);
    const last = x.gatewayTrace.at(-1);
    assert.equal(last.status, 403);
    const grant = last.trace.decisions.find((d) => d.id === 'grant');
    assert.deepEqual([grant.outcome, grant.basis], ['fail', 'inferred']);
    const audit = last.trace.decisions.find((d) => d.id === 'audit-trail');
    assert.deepEqual([audit.outcome, audit.basis], ['fail', 'observed']);
    assert.match(audit.evidence, /DENY/);
    assert.ok(last.trace.decisions.every((d) => d.basis !== 'checked'));
  });
});

test('Real: 401 at the handshake traces initialize alone, authentication failed (inferred), the grant not reached', async () => {
  await withReal('token', async (x) => {
    assert.equal(x.outcome, 'REAL_TOKEN_PROBLEM');
    assert.deepEqual(problems(x.gatewayTrace), []);
    assert.deepEqual(x.gatewayTrace.map((e) => e.title), ['initialize']);
    assert.deepEqual(x.gatewayTrace[0].trace.decisions.map((d) => [d.outcome, d.basis]), [['fail', 'inferred'], ['skipped', 'inferred']]);
    assert.equal(x.gatewayTrace[0].trace.response.headers['www-authenticate'].startsWith('Bearer'), true);
  });
});

test('Real: a 428 hold is for information, never counted as passed', async () => {
  await withReal('hold', async (x) => {
    assert.equal(x.outcome, 'REAL_HOLD');
    assert.deepEqual(problems(x.gatewayTrace), []);
    const last = x.gatewayTrace.at(-1);
    assert.equal(last.status, 428);
    assert.deepEqual(last.trace.decisions.map((d) => [d.outcome, d.basis]), [['info', 'observed']]);
    assert.match(last.trace.decisions[0].evidence, /not a pass/);
  });
});

test('Real: a gateway that is down (503) is one observed information line; no answer at all is a failed reach with no response', async () => {
  await withReal('down', async (x) => {
    assert.deepEqual(problems(x.gatewayTrace), []);
    assert.deepEqual(x.gatewayTrace[0].trace.decisions.map((d) => [d.outcome, d.basis]), [['info', 'observed']]);
  });
  const call = { status: 0, kind: 'unreachable', headers: {}, rpc: null, sent: { message: { jsonrpc: '2.0', id: 1, method: 'initialize' }, headers: {} } };
  const out = realExchanges([{ title: 'initialize', call }], { url: 'https://gw.example/mcp', token: 'x'.repeat(40) });
  assert.equal(out[0].trace.response, null);
  assert.deepEqual(problems(out), []);
  assert.equal(out[0].trace.decisions[0].id, 'reach');
});

test('Real: a run that never reaches the gateway (no act, no token) has an empty trace list', () => {
  assert.deepEqual(realExchanges([], { url: 'https://gw.example/mcp', token: 'x' }), []);
});
