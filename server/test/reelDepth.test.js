// Reel depth: a flow run emits AI-DEMO2's step list (buildTraceSteps order): the frame, the chain with Authorize before the gateway, the
// reply, then the steps AI-DEMO2 lists as not in this run (verdict skip).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase, isFlow } from '../src/flow.js';
import { situationOf } from '../src/situations.js';
import { validateHop } from '../src/vendor/hopDetail.mjs';
import CATALOG from '../src/vendor/hop-catalog.json' with { type: 'json' };

const go = (id, vertical = 'banking') => runUseCase(findUseCase(id), { cast: VERTICALS[vertical], vertical, seed: 'run' });
const ran = (r) => r.hops.filter((h) => h.verdict !== 'skip');
const SKIP_ORDER = ['step-up', 'intent-binding-verified', 'vault-key-inject', 'api-key-swap', 'database-query'];
// Gateway-stage attack events: the gateway runs before Authorize on these chains (documented deviation in flow.js).
const GATEWAY_STAGE = new Set(['tampered-intent-token', 'impersonation-no-act', 'wrong-aud', 'insufficient-scope', 'dpop-replay', 'rate-limit-burst', 'introspection-down']);

test('UC1 banking: the exact AI-DEMO2 order of the hops that ran, then the not-in-path list', () => {
  const r = go('UC1');
  // consent stays where the lab has it: before the agent token, right after the plan (AI-DEMO2 records consent outside the reel).
  assert.deepEqual(ran(r).map((h) => h.kind), ['website', 'sign-in', 'prompt', 'agent-receive', 'tools-list-challenge', 'tools-list', 'llm-plan', 'consent', 'actor-token', 'token-exchange', 'authorize-decision', 'tools-call-challenge', 'gateway-check', 'tool-dispatched', 'api-call', 'agent-reply']);
  assert.deepEqual(r.hops.filter((h) => h.verdict === 'skip').map((h) => h.kind), SKIP_ORDER);
  assert.equal(r.hops.length, 21);
  assert.deepEqual(r.hops.map((h) => h.n), r.hops.map((_, i) => i + 1));
  const prompt = r.hops.find((h) => h.kind === 'prompt');
  assert.deepEqual(prompt.request.body, { message: 'show my balance' });
  assert.equal(prompt.request.headers.authorization, undefined);
  const site = r.hops.find((h) => h.kind === 'website');
  assert.equal(site.request.method, 'GET'); assert.match(site.request.headers.cookie, /^cal_session=mock-/); assert.equal(site.request.headers.authorization, undefined);
  const plan = r.hops.find((h) => h.kind === 'llm-plan');
  assert.equal(plan.from, 'agent'); assert.equal(plan.to, 'llm');
  assert.equal(plan.request.body.model, 'scripted-intent-match (mock)'); assert.deepEqual(plan.response.body.tool_calls, [{ name: 'get_account_balance', arguments: {} }]);
  assert.deepEqual(r.hops.find((h) => h.kind === 'agent-receive').kv, [['routing', 'Scripted intent match'], ['matched use case', 'UC1']]);
  const az = r.hops.find((h) => h.kind === 'authorize-decision');
  assert.equal(az.from, 'bff'); assert.equal(az.to, 'authorize');
  const api = r.hops.find((h) => h.kind === 'api-call');
  assert.equal(api.from, 'mcp'); assert.equal(api.to, 'api'); assert.match(api.request.headers.authorization, /^Bearer eyJ/);
  assert.equal(api.request.headers.authorization, r.hops.find((h) => h.kind === 'tool-dispatched').request.headers.authorization, 'the delegated token');
  assert.match(r.hops.find((h) => h.kind === 'agent-reply').response.body.reply, /get_account_balance/);
});

test('every flow use case in every full vertical keeps the AI-DEMO2 shape', () => {
  let runs = 0;
  for (const vertical of Object.keys(VERTICALS)) for (const uc of MANIFEST.usecases.filter(isFlow)) {
    runs++;
    const at = `${vertical} ${uc.id}`;
    const r = runUseCase(uc, { cast: VERTICALS[vertical], vertical, seed: 'run' });
    const sit = situationOf(uc.id);
    const k = ran(r).map((h) => h.kind);
    const frame = sit.public ? ['website', 'prompt', 'agent-receive', 'tools-list', 'llm-plan'] : ['website', 'sign-in', 'prompt', 'agent-receive', 'tools-list-challenge', 'tools-list', 'llm-plan'];
    assert.deepEqual(k.slice(0, frame.length), frame, at);
    // Authorize before the gateway, when both run (the gateway-stage attack chains never reach Authorize before their gateway refusal).
    const az = k.indexOf('authorize-decision'), gw = k.indexOf('gateway-check');
    if (az >= 0 && gw >= 0) assert.ok(az < gw, `${at}: authorize-decision before gateway-check`);
    if (GATEWAY_STAGE.has(sit.event) && gw >= 0 && az >= 0) assert.fail(`${at}: a gateway-stage attack should stop at the gateway`);
    // A tools/call challenge, when there is one, sits right before the gateway check.
    const ch = k.indexOf('tools-call-challenge');
    if (ch >= 0) assert.equal(k[ch + 1], 'gateway-check', at);
    // Every dispatched tool reaches the resource server next.
    const td = k.indexOf('tool-dispatched');
    if (td >= 0) assert.equal(k[td + 1], 'api-call', at);
    // Skip hops all come after every hop that ran, in AI-DEMO2's order, and never repeat a kind that ran.
    const firstSkip = r.hops.findIndex((h) => h.verdict === 'skip');
    assert.ok(firstSkip > 0, at);
    assert.ok(r.hops.slice(firstSkip).every((h) => h.verdict === 'skip'), `${at}: skips are last`);
    const skips = r.hops.slice(firstSkip).map((h) => h.kind);
    assert.deepEqual(skips, SKIP_ORDER.filter((s) => skips.includes(s)), `${at}: skip order`);
    for (const s of skips) assert.ok(!k.includes(s), `${at}: ${s} ran and is also listed as skipped`);
    const obligated = ran(r).some((h) => h.kind === 'authorize-decision' && h.verdict === 'obligation');
    assert.equal(skips.includes('step-up'), !obligated, `${at}: step-up skipped only when no obligation`);
    for (const s of ['vault-key-inject', 'api-key-swap', 'database-query']) assert.ok(skips.includes(s), `${at}: ${s}`);
    for (const h of r.hops.slice(firstSkip)) { assert.deepEqual(h.request, {}); assert.ok(h.note && /^No /.test(h.note), `${at}: ${h.kind} says why`); assert.equal(h.fact, 'not in this path'); }
    // A reply only on a finished run: never after a refusal or a hold.
    const stopped = k.includes('tool-refused') || k.includes('tool-held') || r.outcome === 'CIBA';
    assert.equal(k.includes('agent-reply'), !stopped, `${at}: reply`);
    if (!stopped) assert.equal(k.at(-1), 'agent-reply', at);
    for (const h of r.hops) {
      assert.ok(Object.hasOwn(CATALOG.kinds, h.kind), `${at}: ${h.kind} has a catalog entry`);
      assert.deepEqual(validateHop(h, CATALOG, { tokens: 'raw' }), [], `${at} hop ${h.n} ${h.kind}`);
    }
  }
  assert.equal(runs, 54 * 3);
});

test('challenge hops: no Authorization header, 401, WWW-Authenticate with resource_metadata, the RFC 9728 document in kv', () => {
  let seen = 0;
  for (const uc of MANIFEST.usecases.filter(isFlow)) for (const h of go(uc.id).hops.filter((x) => x.kind === 'tools-list-challenge' || x.kind === 'tools-call-challenge')) {
    seen++;
    assert.equal(h.request.headers.authorization, undefined, `${uc.id} ${h.kind}`);
    assert.equal(h.request.body.method, h.kind === 'tools-list-challenge' ? 'tools/list' : 'tools/call');
    assert.equal(h.response.status, 401);
    assert.match(h.response.headers['www-authenticate'], /^Bearer realm="mcp", error="invalid_token", resource_metadata="https:\/\/gateway\.[a-z0-9-]+\.example\/\.well-known\/oauth-protected-resource"$/);
    assert.deepEqual(h.kv.map(([key]) => key), ['resource', 'authorization_servers', 'scopes_supported']);
    assert.equal(h.verdict, 'ok', 'a 401 to an anonymous caller is the expected answer');
  }
  assert.ok(seen > 60, `only ${seen} challenge hops`);
  // Public calls: no challenge, no bearer anywhere.
  const pub = go('UC24');
  assert.ok(!pub.hops.some((h) => /challenge/.test(h.kind)));
  assert.equal(pub.hops.find((h) => h.kind === 'tools-list').request.headers.authorization, undefined);
});

test('the tools/list hop carries the user token of the session and the MCP session line', () => {
  const r = go('UC1');
  const tl = r.hops.find((h) => h.kind === 'tools-list');
  assert.equal(tl.request.headers.authorization, `Bearer ${r.tokens.find((t) => /user token/.test(t.label)).raw}`);
  assert.deepEqual(tl.kv[0], ['MCP session', 'initialize -> 2025-11-25 -> notifications/initialized']);
  assert.deepEqual(tl.response.body.result.tools.map((t) => t.name), ['get_account_balance']);
});

test('reorder cases: an Authorize refusal stops before the gateway; a held write never meets it; gateway-stage attacks keep their chain', () => {
  const six = ran(go('UC6')).map((h) => h.kind);
  assert.deepEqual(six.slice(-2), ['authorize-decision', 'tool-refused']); assert.ok(!six.includes('gateway-check'));
  const seven = ran(go('UC7')).map((h) => h.kind);
  assert.deepEqual(seven.slice(-2), ['authorize-decision', 'tool-held']); assert.ok(!seven.includes('gateway-check'));
  assert.ok(!go('UC7').hops.some((h) => h.kind === 'step-up'), 'UC7 had a step-up obligation, so step-up is not listed as skipped');
  for (const id of ['UC15', 'UC16']) {
    const k = ran(go(id)).map((h) => h.kind);
    assert.deepEqual(k.slice(-2), ['gateway-check', 'tool-refused'], id); assert.ok(!k.includes('authorize-decision'), id);
  }
});
