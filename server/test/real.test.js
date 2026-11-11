// Full Real (owner, 2026-11-10) against FAKES only: the fake PingOne (pi.flow, flows API, resume, code, client credentials, the two token exchanges that
// mint and carry act) and the fake Agent Gateway (MCP). Nothing here reaches a real PingOne or SE.
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
import { AGENT_AUDIENCE, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET, AGENT_SCOPE, AUDIENCE, CLIENT_SECRET, DEMO_PASSWORD, DEMO_USERNAME, ENV_ID, SCOPE, USER_CLIENT_SECRET, fullSettingsFor, settingsFor, startFakePingOne } from './fakePingone.js';
import { AUDIT_TRAIL, startFakeGateway } from './fakeGateway.js';

const ENV = { ALLOW_MOCK_SIGNIN: '1' };
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
// Starts both fakes and a lab with full Real; fn(url, { p1, gw, real }). setup(p1): change the fake PingOne before the lab runs (its resources, grants).
async function withFull(fn, { signin = 'ok', exchange = 'ok', gateway = 'ok', env = ENV, agentScope, settings = {}, setup } = {}) {
  const p1 = await startFakePingOne(agentScope ? { agentScope } : {});
  p1.state.full = { signin, exchange };
  if (setup) setup(p1);
  const gw = await startFakeGateway({ behaviour: gateway, isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url, settings), { CAL_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  try { await withServer((url) => fn(url, { p1, gw, real }), { env, real }); } finally { await p1.close(); await gw.close(); }
}
const toReal = (url, h = {}) => post(url, '/api/mode', { source: 'real' }, h);
const signIn = async (url, password = DEMO_PASSWORD, h = {}) => { const r = await post(url, '/api/signin', { password }, h); return { status: r.status, text: await r.clone().text(), body: await r.json() }; };
const SECRETS = [DEMO_PASSWORD, USER_CLIENT_SECRET, AGENT_CLIENT_SECRET, CLIENT_SECRET];
const noSecret = (text, what) => { for (const s of SECRETS) assert.ok(!text.includes(s), `${what} carries a secret or the password`); };
const TX = 'urn:ietf:params:oauth:grant-type:token-exchange';
const claimsOf = (raw) => JSON.parse(Buffer.from(raw.split('.')[1], 'base64url').toString('utf8'));
// What the lab sent to the fake PingOne's token endpoint, in order: the form and the Authorization header.
const tokenCalls = (p1) => p1.seen.filter((c) => c.method === 'POST' && c.url.endsWith('/as/token')).map((c) => ({ form: Object.fromEntries(new URLSearchParams(c.body)), auth: c.headers.authorization }));
const BASIC_AGENT = `Basic ${Buffer.from(`${AGENT_CLIENT_ID}:${AGENT_CLIENT_SECRET}`).toString('base64')}`;

test('the full chain: pi.flow sign-in, agent token, TWO token exchanges (act = agent, then for the gateway), gateway initialize + tools/list + tools/call, a real reply; every hop REAL', async () => {
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
    assert.deepEqual(x.hops.map((h) => h.kind), ['sign-in', 'actor-token', 'token-exchange', 'token-exchange', 'gateway-check', 'authorize-decision', 'tool-dispatched', 'api-call', 'agent-reply']);
    assert.deepEqual(x.hops.slice(2, 4).map((h) => h.title), ['Exchange 1: act = agent', 'Exchange 2: for the gateway'], 'the two exchanges are told apart');
    assert.match(x.hops[2].label, /^Token exchange 1 \[REAL\]: act = agent/); assert.match(x.hops[3].label, /^Token exchange 2 \[REAL\]: for the gateway/);
    assert.ok(x.hops.every((h) => h.source === 'real' && h.mock === false && /\[REAL\]/.test(h.label)), 'every hop ran for real and says so');
    assert.deepEqual([x.hops[2].response.body.act_claim, x.hops[3].response.body.act_claim], [{ sub: AGENT_CLIENT_ID }, { sub: AGENT_CLIENT_ID }], 'both exchange hops show the act they got');
    assert.equal(x.traceparent.split('-')[1], TP.split('-')[1]);
    // The Tokens tab: the user, the agent (actor), exchange 1 and the delegated (exchange 2) token, each raw with its decoded claims.
    assert.equal(x.tokens.length, 4); assert.ok(x.tokens.every((t) => t.real && t.raw.split('.').length === 3), 'all four are shown raw');
    const [userTok, agentTok, ex1Tok, delegated] = x.tokens;
    assert.match(userTok.label, /^user access token/); assert.match(agentTok.label, /^agent token/); assert.match(ex1Tok.label, /^exchange 1 token.*act = agent/); assert.match(delegated.label, /^delegated token.*exchange 2/);
    assert.deepEqual(agentTok.claims.scope, AGENT_SCOPE);
    assert.deepEqual(ex1Tok.claims.act, { sub: AGENT_CLIENT_ID }); assert.equal(ex1Tok.claims.aud, AGENT_AUDIENCE); assert.equal(ex1Tok.claims.scope, AGENT_SCOPE); assert.equal(ex1Tok.claims.sub, userTok.claims.sub, 'exchange 1 keeps the user as the subject');
    assert.deepEqual(delegated.claims.act, { sub: AGENT_CLIENT_ID }, 'act carried over to exchange 2'); assert.equal(delegated.claims.aud, 'fake-gateway-audience'); assert.equal(delegated.claims.scope, SCOPE); assert.equal(delegated.claims.sub, userTok.claims.sub);
    assert.deepEqual([ex1Tok.expectAct, delegated.expectAct], [true, true], 'the page shows act next to the exchange tokens');
    // What the lab sent to PingOne: the code, the actor token, exchange 1, exchange 2 (in that order).
    const calls = tokenCalls(p1);
    assert.deepEqual(calls.map((c) => c.form.grant_type), ['authorization_code', 'client_credentials', TX, TX]);
    assert.equal(calls[1].form.scope, AGENT_SCOPE, 'the actor token asks for the agent scope'); assert.equal(calls[1].auth, BASIC_AGENT);
    const [e1, e2] = [calls[2], calls[3]];
    assert.deepEqual(e1.form, { grant_type: TX, subject_token: userTok.raw, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', actor_token: agentTok.raw, actor_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: AGENT_SCOPE }, 'exchange 1: the user as subject, the agent as actor, the agent scope, no audience');
    assert.deepEqual(e2.form, { grant_type: TX, subject_token: ex1Tok.raw, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: SCOPE }, 'exchange 2: the exchange-1 token as subject, NO actor token, NO audience, the gateway scope');
    assert.deepEqual([e1.auth, e2.auth], [BASIC_AGENT, BASIC_AGENT], 'both exchanges authenticate as the agent app');
    // The old single exchange is gone: no call asks for the gateway scope with an actor, and none sends an audience.
    assert.equal(calls.filter((c) => c.form.grant_type === TX).length, 2);
    assert.ok(!calls.some((c) => c.form.actor_token && c.form.scope === SCOPE), 'no exchange has the actor and the gateway scope together');
    assert.ok(calls.every((c) => c.form.audience === undefined && c.form.resource === undefined), 'no audience or resource parameter is sent');
    const methods = gw.seen.map((c) => c.rpc.method);
    assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'tools/call']);
    assert.deepEqual(gw.seen.slice(3).map((c) => c.rpc.params.name), ['get_my_accounts', 'get_account_balance']);
    assert.equal(gw.seen[4].rpc.params.arguments.account_id, 'acct-fake-1');
    for (const c of gw.seen) {
      assert.equal(c.headers['x-token-validation'], 'jwks'); assert.equal(c.headers['x-active-vertical'], 'banking'); assert.match(c.headers.traceparent, /^00-0af7651916cd43dd8448eb211c80319c-/);
      assert.ok(p1.issued.delegated.has(c.headers.authorization.slice(7)), 'the bearer is the delegated token');
      assert.equal(c.headers.authorization, `Bearer ${delegated.raw}`, 'the bearer is the exchange-2 token, not the user, agent or exchange-1 token');
    }
    assert.ok(gw.seen.slice(1).every((c) => c.headers['mcp-session-id'] === 'fake-mcp-session-0001'), 'Mcp-Session-Id after initialize');
    noSecret(JSON.stringify(r.body) + s.text, 'the run or the sign-in answer');
    assert.ok(!JSON.stringify(r.body).includes('fake-refresh-never-shown'), 'the refresh token is dropped');
    // A token is raw in the token list only: no hop (request, response or note) carries one of the four.
    for (const t of x.tokens) assert.ok(!JSON.stringify(x.hops).includes(t.raw), `a hop carries the raw ${t.label}`);
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
      assert.equal(x.hops.length, 9, `${behaviour}: always the nine hops`);
      assert.ok(x.hops.every((h) => (h.source === 'real') === (h.verdict !== 'skip')), `${behaviour}: a hop that did not run says NOT RUN, never REAL`);
      assert.ok(x.hops.every((h) => (h.source === 'not-run' ? /\[NOT RUN\]$/ : /\[REAL\]/).test(h.label)), `${behaviour}: the label says what the source says`);
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
  // A refused exchange 1: PingOne says so, exchange 2 is NOT RUN, the gateway is never called.
  await withFull(async (url, { gw, p1 }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_REFUSED'); assert.equal(x.reply.who, 'PingOne'); assert.match(x.reply.text, /refused token exchange 1 \(HTTP 400: invalid_request\)/); assert.equal(gw.seen.length, 0);
    assert.deepEqual(x.hops.slice(2, 4).map((h) => [h.source, h.verdict]), [['real', 'deny'], ['not-run', 'skip']]); assert.match(x.hops[3].label, /^Token exchange 2: for the gateway \[NOT RUN\]$/);
    assert.equal(tokenCalls(p1).filter((c) => c.form.grant_type === TX).length, 1, 'exchange 2 was not attempted');
  }, { exchange: 'refuse' });
  // A refused exchange 2: the exchange-1 token is still shown, the gateway is never called.
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_REFUSED'); assert.match(x.reply.text, /refused token exchange 2 \(HTTP 400: invalid_request\)/); assert.equal(gw.seen.length, 0);
    assert.deepEqual(x.hops.slice(2, 4).map((h) => [h.source, h.verdict]), [['real', 'ok'], ['real', 'deny']]); assert.equal(x.tokens.length, 3, 'user, agent and exchange-1 tokens');
  }, { exchange: 'refuse-2' });
  // The agent app has no grant for the agent scope (the owner has not re-run the setup script yet): the actor token is refused, and the words say what to do.
  await withFull(async (url, { gw, p1 }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_REFUSED'); assert.match(x.reply.text, /scope agent:invoke \(invalid_scope\).*no grant.*pingone-real-setup\.mjs --apply/s);
    assert.equal(x.hops.length, 9); assert.deepEqual(x.hops.slice(2, 4).map((h) => h.source), ['not-run', 'not-run']); assert.equal(gw.seen.length, 0);
    assert.equal(tokenCalls(p1).filter((c) => c.form.grant_type === TX).length, 0);
  }, { setup: (p1) => { p1.state.agentGrants = [SCOPE]; } });
});

test('act is required: a token without act after exchange 2 stops the run BEFORE the gateway (nothing is sent to it), with the clear message', async () => {
  const MSG = "the delegated token carries no act claim: check the agent:invoke resource's act attribute";
  // (a) The agent scope's resource has no act attribute: exchange 1 already has no act, so exchange 2 is not spent.
  await withFull(async (url, { gw, p1 }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.status, 200); const x = r.body.run;
    assert.equal(x.outcome, 'REAL_NO_ACT'); assert.equal(x.reply.who, 'PingOne'); assert.ok(x.reply.text.includes(MSG), x.reply.text); assert.match(x.reply.text, /nothing was sent to it/);
    assert.equal(gw.seen.length, 0, 'the gateway was never called'); assert.equal(x.hops.length, 9);
    assert.deepEqual(x.hops.map((h) => h.source), ['real', 'real', 'real', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run']);
    assert.equal(x.hops[2].verdict, 'deny'); assert.match(x.hops[2].note, /NO act claim/); assert.equal(x.hops[2].response.body.act_claim, 'ABSENT'); assert.match(x.hops[3].note, /exchange 1 carries no act claim/);
    assert.equal(tokenCalls(p1).filter((c) => c.form.grant_type === TX).length, 1, 'exchange 2 only passes act through, so it is not attempted');
    assert.deepEqual(x.tokens.map((t) => t.claims.act === undefined), [true, true, true]); assert.equal(x.tokens[2].expectAct, true, 'the page can say "no act claim" next to it');
  }, { setup: (p1) => { p1.state.resources.agent.act = 'absent'; } });
  // (b) Exchange 1 has act, but the gateway scope's resource does not pass it through (the old bug's cousin): exchange 2 has none, the gateway is not called.
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_NO_ACT'); assert.ok(x.reply.text.includes(MSG)); assert.match(x.reply.text, /Exchange 1 had the claim.*passes the subject token's act through.*never edits that resource/);
    assert.equal(gw.seen.length, 0); assert.equal(x.hops.length, 9);
    assert.deepEqual(x.hops.map((h) => h.source), ['real', 'real', 'real', 'real', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run']);
    assert.deepEqual(x.hops.slice(2, 4).map((h) => h.verdict), ['ok', 'deny']); assert.equal(x.hops[3].response.body.act_claim, 'ABSENT');
    assert.equal(x.tokens.length, 4); assert.deepEqual(x.tokens[2].claims.act, { sub: AGENT_CLIENT_ID }); assert.equal(x.tokens[3].claims.act, undefined);
    assert.ok(x.hops.every((h) => (h.source === 'not-run' ? /\[NOT RUN\]$/ : /\[REAL\]/).test(h.label)));
  }, { setup: (p1) => { p1.state.resources.gateway.act = 'absent'; } });
  // (d) An act that names nobody (no sub) is no act: HasValidActorChain could not match it.
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_NO_ACT'); assert.equal(gw.seen.length, 0); assert.equal(x.hops[2].response.body.act_claim, 'ABSENT');
  }, { setup: (p1) => { p1.state.resources.agent.act = 'empty'; } });
  // (c) With a correct setup the same use case reaches the gateway (the contrast).
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).body.run.outcome, 'REAL_PERMIT'); assert.ok(gw.seen.length >= 3);
  });
});

test('the fake PingOne models the old bug: ONE exchange (user + agent actor + gateway scope) or an exchange 2 on the plain user token mints NO act, and the gateway refuses it', async () => {
  const p1 = await startFakePingOne();
  const gw = await startFakeGateway({ isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url), { CAL_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  try {
    assert.equal((await real.signIn('w', DEMO_PASSWORD)).ok, true);
    const user = real.session('w').accessToken;
    const AT = 'urn:ietf:params:oauth:token-type:access_token';
    const post = async (form) => (await fetch(`${p1.base}/as/token`, { method: 'POST', headers: { authorization: BASIC_AGENT, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })).json();
    const agent = (await post({ grant_type: 'client_credentials', scope: AGENT_SCOPE })).access_token;
    const one = await post({ grant_type: TX, subject_token: user, subject_token_type: AT, actor_token: agent, actor_token_type: AT, audience: AUDIENCE, scope: SCOPE });
    assert.equal(claimsOf(one.access_token).act, undefined, 'the old single exchange: no act');
    const plain = await post({ grant_type: TX, subject_token: user, subject_token_type: AT, scope: SCOPE });
    assert.equal(claimsOf(plain.access_token).act, undefined, 'exchange 2 on a plain user token: no act');
    const init = (token) => fetch(gw.url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert.equal((await init(one.access_token)).status, 401, 'the gateway refuses the act-less token'); assert.equal((await init(plain.access_token)).status, 401);
    const ex1 = await post({ grant_type: TX, subject_token: user, subject_token_type: AT, actor_token: agent, actor_token_type: AT, scope: AGENT_SCOPE });
    assert.deepEqual(claimsOf(ex1.access_token).act, { sub: AGENT_CLIENT_ID }, 'exchange 1 mints act from the actor token, only on the agent scope');
    const ex2 = await post({ grant_type: TX, subject_token: ex1.access_token, subject_token_type: AT, scope: SCOPE });
    assert.deepEqual(claimsOf(ex2.access_token).act, { sub: AGENT_CLIENT_ID }, 'exchange 2 passes it through'); assert.equal((await init(ex2.access_token)).status, 200);
    const onGateway = await post({ grant_type: TX, subject_token: user, subject_token_type: AT, actor_token: agent, actor_token_type: AT, scope: SCOPE });
    assert.equal(claimsOf(onGateway.access_token).act, undefined, 'the gateway scope never mints act from an actor token');
    assert.equal((await post({ grant_type: TX, subject_token: user, subject_token_type: AT, scope: 'no:such:scope' })).error, 'invalid_scope');
  } finally { await p1.close(); await gw.close(); }
});

test('CAL_AGENT_SCOPE: optional, default agent:invoke; a custom scope is what the actor token and exchange 1 ask for; a bad one names the setting', async () => {
  const good = fullSettingsFor('https://gw.lab-test.net/mcp');
  assert.equal(realConfig(good, {}).agentScope, 'agent:invoke'); assert.equal(realConfig({ ...good, CAL_AGENT_SCOPE: '' }, {}).agentScope, 'agent:invoke', 'empty (compose passes an empty value) is the default');
  assert.equal(realConfig({ ...good, CAL_AGENT_SCOPE: 'custom:agent' }, {}).agentScope, 'custom:agent');
  for (const v of ['a  b', ' a', 'a"b', 'a\nb', 'x'.repeat(301)]) assert.match(realConfig({ ...good, CAL_AGENT_SCOPE: v }, {}).problem, /CAL_AGENT_SCOPE/, JSON.stringify(v.slice(0, 8)));
  assert.deepEqual(missingFull(good), [], 'it is not one of the required names'); assert.ok(!FULL_KEYS.includes('CAL_AGENT_SCOPE'));
  assert.equal(fullWanted({ CAL_AGENT_SCOPE: 'custom:agent' }), false, 'on its own it does not make full Real the target');
  await withFull(async (url, { p1 }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_PERMIT');
    assert.deepEqual(tokenCalls(p1).slice(1, 3).map((c) => c.form.scope), ['custom:agent', 'custom:agent']);
    assert.match(x.hops[1].label, /scope custom:agent/);
  }, { agentScope: 'custom:agent', settings: { CAL_AGENT_SCOPE: 'custom:agent' } });
});

test('the exchange-2 token\'s aud is checked against CAL_GATEWAY_AUDIENCE: a difference is a clear note, not a stop', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.match(x.hops[3].note, /The token's aud \(fake-gateway-audience\) is not CAL_GATEWAY_AUDIENCE.*Check which resource owns the gateway scope/);
    assert.match(x.tokens[3].notice, /is not CAL_GATEWAY_AUDIENCE/); assert.ok(gw.seen.length >= 3, 'the run went on');
  }, { settings: { CAL_GATEWAY_AUDIENCE: 'https://some-other-audience.example/mcp' } });
  await withFull(async (url) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.doesNotMatch(x.hops[3].note, /CAL_GATEWAY_AUDIENCE/, 'no note when the audience matches');
  });
});

test('the password is never logged, stored, returned or shown in a hop; the sign-in answer carries a fixed placeholder', async () => {
  const logs = []; const rawTokens = [];
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
      assert.equal(r.body.run.tokens.length, 4); rawTokens.push(...r.body.run.tokens.map((t) => t.raw));
      const texts = [s.text, JSON.stringify(r.body)];
      for (const p of ['/api/info', '/api/signin', '/api/runs', '/api/mode', '/api/health']) texts.push(await (await get(url, p)).text());
      noSecret(texts.join(''), 'an answer');
      const session = real.session('default');
      assert.ok(!JSON.stringify(session).includes(DEMO_PASSWORD), 'the session holds no password');
    });
  } finally { Object.assign(console, orig); }
  assert.ok(!logs.join('\n').includes(DEMO_PASSWORD), 'no log line carries the password');
  for (const secret of [...SECRETS, ...rawTokens]) assert.ok(!logs.join('\n').includes(secret), 'no log line carries a client secret or a token');
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
  for (const [k, v] of [['CAL_USER_CLIENT_ID', ''], ['CAL_AGENT_CLIENT_SECRET', 'a\nb'], ['CAL_AGENT_GATEWAY_URL', 'http://gw.lab-test.net/mcp'], ['CAL_AGENT_GATEWAY_URL', 'https://u:p@gw.lab-test.net/'], ['CAL_GATEWAY_SCOPE', 'a  b'], ['CAL_AGENT_SCOPE', 'a  b'], ['PINGONE_ENVIRONMENT_ID', 'x']]) {
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

test('review fixes: a password echoed by PingOne never comes back; state and nonce are required; the sign-in is refused under the guards', async () => {
  await withFull(async (url) => {
    await toReal(url);
    const s = await signIn(url);
    assert.equal(s.status, 401); assert.ok(!s.text.includes(DEMO_PASSWORD), 'an echoed password is not passed on');
    assert.ok(!s.text.includes('fake echo'), 'after the password step only PingOne error codes are kept');
  }, { signin: 'echo-pw' });
  for (const v of ['bad-state', 'no-state']) {
    await withFull(async (url) => {
      await toReal(url);
      const s = await signIn(url); assert.equal(s.status, 502, v); assert.match(s.body.message, /without the state the lab sent/);
    }, { signin: v });
  }
  for (const [env, headers] of [[{ ...ENV, CAL_ALLOW_LIVE: '0' }, {}], [ENV, { 'x-forwarded-for': '10.0.0.1' }]]) {
    await withFull(async (url, { p1 }) => {
      const r = await post(url, '/api/signin', { password: DEMO_PASSWORD }, headers);
      assert.equal(r.status, 409); assert.equal(p1.seen.length, 0, 'nothing was sent to PingOne');
    }, { env });
  }
});

test('review fixes: a gateway redirect is never followed; one account means no transfer; control characters never become a decision', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.body.run.outcome, 'REAL_REFUSED'); assert.equal(gw.state.elsewhere, 0);
  }, { gateway: 'redirect' });
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC6', { vertical: 'banking' });
    assert.equal(r.body.run.outcome, 'REAL_TOOL_ERROR'); assert.equal(r.body.run.hops.length, 9);
    assert.ok(!gw.seen.some((c) => c.rpc?.params?.name === 'create_transfer'), 'create_transfer is never called with one account');
  }, { gateway: 'one-account' });
  await withFull(async (url) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.body.run.outcome, 'REAL_DENY'); assert.doesNotMatch(r.body.run.reply.text, /[\u0000-\u001f]/);
    assert.equal(r.body.run.hops.find((h) => h.kind === 'authorize-decision').decision.outcome, 'DENY', 'falls back to the HTTP answer');
  }, { gateway: 'audit-ctl' });
});
