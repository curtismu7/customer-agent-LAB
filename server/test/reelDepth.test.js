// Reel depth: a flow run emits AI-DEMO2's step list (buildTraceSteps order): the frame, the chain with Authorize before the gateway, the
// reply, then the steps AI-DEMO2 lists as not in this run (verdict skip).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase, isFlow, REEL_TABLES } from '../src/flow.js';
import { situationOf } from '../src/situations.js';
import { validateHop } from '../src/vendor/hopDetail.mjs';
import CATALOG from '../src/vendor/hop-catalog.json' with { type: 'json' };

const go = (id, vertical = 'banking', extra = {}) => runUseCase(findUseCase(id), { cast: VERTICALS[vertical], vertical, seed: 'run', ...extra });
const ran = (r) => r.hops.filter((h) => h.verdict !== 'skip');
const ranKinds = (r) => ran(r).map((h) => h.kind);
const skipOf = (r, kind) => r.hops.find((h) => h.verdict === 'skip' && h.kind === kind);
const SKIP_ORDER = ['step-up', 'intent-binding-verified', 'vault-key-inject', 'api-key-swap', 'database-query'];
const { PLANS, CALLS_TOOL, API_KEY_PATH, A2A_PROTOCOL } = REEL_TABLES;
const everyRun = function* () {
  for (const vertical of Object.keys(VERTICALS)) for (const uc of MANIFEST.usecases.filter(isFlow)) yield { at: `${vertical} ${uc.id}`, uc, r: runUseCase(uc, { cast: VERTICALS[vertical], vertical, seed: 'run' }) };
};

test('UC1 banking: the exact AI-DEMO2 order of the hops that ran, then the not-in-path list', () => {
  const r = go('UC1');
  // consent stays where the lab has it: before the agent token, right after the plan (AI-DEMO2 records consent outside the reel).
  assert.deepEqual(ranKinds(r), ['website', 'sign-in', 'prompt', 'agent-receive', 'tools-list-challenge', 'tools-list', 'llm-plan', 'consent', 'actor-token', 'token-exchange', 'authorize-decision', 'tools-call-challenge', 'gateway-check', 'tool-dispatched', 'api-call', 'agent-reply']);
  assert.deepEqual(r.hops.filter((h) => h.verdict === 'skip').map((h) => h.kind), SKIP_ORDER);
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
  for (const { at, uc, r } of everyRun()) {
    runs++;
    const sit = situationOf(uc.id);
    const k = ranKinds(r);
    const head = sit.public ? ['website', 'prompt', 'agent-receive'] : ['website', 'sign-in', 'prompt', 'agent-receive'];
    assert.deepEqual(k.slice(0, head.length), head, at);
    // Only a run whose agent plans a tool call lists its tools and plans; the rest go from agent-receive straight to the chain.
    const plan = PLANS.has(uc.id) ? [...(sit.public ? [] : ['tools-list-challenge']), 'tools-list', 'llm-plan'] : [];
    assert.deepEqual(k.slice(head.length, head.length + plan.length), plan, at);
    for (const f of ['tools-list-challenge', 'tools-list', 'llm-plan']) if (!plan.includes(f)) assert.ok(!k.includes(f), `${at}: ${f} on a run that plans no tool call`);
    // Authorize before the gateway, when both run.
    const az = k.indexOf('authorize-decision'), gw = k.indexOf('gateway-check');
    if (az >= 0 && gw >= 0) assert.ok(az < gw, `${at}: authorize-decision before gateway-check`);
    const ch = k.indexOf('tools-call-challenge');
    if (ch >= 0) assert.equal(k[ch + 1], 'gateway-check', at);
    // A gateway that forwarded the call is always followed by the tool, before any other gateway check.
    ran(r).forEach((h, i, all) => {
      if (h.kind !== 'gateway-check' || h.verdict !== 'ok') return;
      const rest = all.slice(i + 1).map((x) => x.kind);
      const nextGw = rest.indexOf('gateway-check');
      assert.ok(rest.slice(0, nextGw < 0 ? undefined : nextGw).includes('tool-dispatched'), `${at}: hop ${h.n} forwarded with no tool after it`);
    });
    // Every dispatched tool reaches its back end: the bearer api-call, or the API-key path drawn before it.
    const td = k.indexOf('tool-dispatched');
    if (td >= 0 && API_KEY_PATH.has(uc.id)) { assert.deepEqual(k.slice(td - 2, td), ['vault-key-inject', 'api-key-swap'], at); assert.ok(!k.includes('api-call'), at); }
    else if (td >= 0) assert.equal(k[td + 1], 'api-call', at);
    // An obligation always draws a real step-up hop right after the decision.
    const ob = ran(r).find((h) => h.kind === 'authorize-decision' && h.verdict === 'obligation');
    if (ob) assert.equal(k[k.indexOf('authorize-decision') + 1], 'step-up', at); else assert.ok(!k.includes('step-up'), at);
    // Skip hops all come after every hop that ran, in AI-DEMO2's order, and never repeat a kind that ran.
    const firstSkip = r.hops.findIndex((h) => h.verdict === 'skip');
    assert.ok(firstSkip > 0, at);
    assert.ok(r.hops.slice(firstSkip).every((h) => h.verdict === 'skip'), `${at}: skips are last`);
    const skips = r.hops.slice(firstSkip).map((h) => h.kind);
    assert.deepEqual(skips, SKIP_ORDER.filter((s) => skips.includes(s)), `${at}: skip order`);
    for (const s of SKIP_ORDER) assert.notEqual(k.includes(s), skips.includes(s), `${at}: ${s} is either run or listed as skipped`);
    for (const h of r.hops.slice(firstSkip)) { assert.deepEqual(h.request, {}); assert.ok(h.note && /^No /.test(h.note), `${at}: ${h.kind} says why`); assert.equal(h.fact, 'not in this path'); }
    // A reply only on a finished run, built from the tool result or the run's own narration: never a bare "Done".
    const stopped = k.includes('tool-refused') || k.includes('tool-held') || r.outcome === 'CIBA';
    assert.equal(k.includes('agent-reply'), !stopped, `${at}: reply`);
    if (!stopped) {
      assert.equal(k.at(-1), 'agent-reply', at);
      const text = ran(r).at(-1).response.body.reply;
      assert.doesNotMatch(text, /^Done/, at);
      if (td < 0) assert.ok(text.startsWith('No tool was called.') && text.includes(r.outcome), `${at}: ${text}`);
      else assert.match(text, /^Here is what I found: mock result of /, at);
    }
    // A use case that reaches the MCP server in AI-DEMO2 reaches it here when the run is not refused or held.
    if (CALLS_TOOL.has(uc.id) && !stopped) assert.ok(td >= 0, `${at}: calls a tool`);
    for (const h of r.hops) {
      assert.ok(Object.hasOwn(CATALOG.kinds, h.kind), `${at}: ${h.kind} has a catalog entry`);
      assert.deepEqual(validateHop(h, CATALOG, { tokens: 'raw' }), [], `${at} hop ${h.n} ${h.kind}`);
    }
  }
  assert.equal(runs, 54 * 3);
});

test('skip notes never contradict the hops that ran', () => {
  for (const { at, r } of everyRun()) {
    const k = ranKinds(r);
    const pushed = ran(r).some((h) => JSON.stringify(h.request?.body ?? '').includes('authorization_details'));
    const ib = skipOf(r, 'intent-binding-verified');
    if (ib && /no authorization_details were pushed/.test(ib.note)) assert.ok(!pushed, `${at}: authorization_details were pushed`);
    if (ib && pushed) assert.equal(ib.note, 'No separate intent-binding check ran in this path.', at);
    const su = skipOf(r, 'step-up');
    if (su && /policy decision asked/.test(su.note)) assert.ok(k.includes('authorize-decision'), at);
    if (su && /refused before any policy decision/.test(su.note)) assert.ok(!k.includes('authorize-decision') && k.includes('tool-refused'), at);
    if (su && /no policy decision ran/.test(su.note)) assert.ok(!k.includes('authorize-decision') && !k.includes('tool-refused'), at);
    for (const kind of ['vault-key-inject', 'api-key-swap', 'database-query']) {
      const s = skipOf(r, kind);
      if (!s) continue;
      if (/no tool (call|ran)/.test(s.note)) assert.ok(!k.includes('tool-dispatched'), `${at}: ${kind}`);
      else assert.ok(k.includes('tool-dispatched'), `${at}: ${kind}`);
    }
  }
  // The two cases the review named: authorization_details on the decision (UC14), and a refusal before any decision (UC5).
  assert.equal(skipOf(go('UC14'), 'intent-binding-verified').note, 'No separate intent-binding check ran in this path.');
  assert.equal(skipOf(go('UC5'), 'step-up').note, 'No step-up: the run was refused before any policy decision ran.');
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
  assert.ok(seen > 50, `only ${seen} challenge hops`);
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

test('fidelity: UC3 runs the dispatch leg; UC40 has the agent token first; UC33 the API-key path; UC2 the A2A handoff; UC7 a real step-up', () => {
  assert.deepEqual(ranKinds(go('UC3')).slice(-6), ['authorize-decision', 'tools-call-challenge', 'gateway-check', 'tool-dispatched', 'api-call', 'agent-reply']);
  // UC40 does not run the dispatch leg: its redeemed ID-JAG token has no act claim, the lab gateway would refuse it (DENY_401) and change the outcome.
  const forty = go('UC40');
  assert.deepEqual(ranKinds(forty).slice(-5), ['enterprise-managed-mode', 'actor-token', 'id-jag-issued', 'id-jag-redeemed', 'agent-reply']);
  assert.equal(forty.outcome, 'PERMIT');
  const k33 = ranKinds(go('UC33'));
  assert.deepEqual(k33.slice(-6), ['tools-call-challenge', 'gateway-check', 'vault-key-inject', 'api-key-swap', 'tool-dispatched', 'agent-reply']);
  const r33 = go('UC33');
  const vault = r33.hops.find((h) => h.kind === 'vault-key-inject'), swap = r33.hops.find((h) => h.kind === 'api-key-swap');
  assert.equal(vault.to, 'credentials'); assert.equal(vault.response.body.api_key, '[write-only]');
  assert.deepEqual(Object.keys(swap.request.headers).sort(), ['traceparent', 'x-api-key', 'x-user-sub']);
  assert.equal(swap.request.headers['x-api-key'], '[write-only]'); assert.equal(swap.request.headers.authorization, undefined);
  for (const id of A2A_PROTOCOL) {
    const k = ranKinds(go(id));
    const at = k.indexOf('a2a-exchange-2');
    assert.deepEqual(k.slice(at, at + 3), ['a2a-exchange-2', 'a2a-agent-card', 'a2a-protocol-message'], id);
  }
  const seven = go('UC7');
  const su = seven.hops.find((h) => h.kind === 'step-up');
  assert.equal(su.response.status, 428); assert.equal(su.verdict, 'obligation'); assert.equal(su.response.body.obligation, 'STEP_UP'); assert.match(su.response.body.note, /simulates the approval/);
  assert.equal(go('UC8').hops.find((h) => h.kind === 'step-up').verdict, 'held');
  assert.equal(go('UC22').hops.find((h) => h.kind === 'step-up').response.status, 202);
});

test('reorder cases: an Authorize refusal stops before the gateway; a held write never meets it; gateway-stage attacks keep their chain', () => {
  const six = ranKinds(go('UC6'));
  assert.deepEqual(six.slice(-2), ['authorize-decision', 'tool-refused']); assert.ok(!six.includes('gateway-check'));
  const seven = ranKinds(go('UC7'));
  assert.deepEqual(seven.slice(-3), ['authorize-decision', 'step-up', 'tool-held']); assert.ok(!seven.includes('gateway-check'));
  for (const id of ['UC15', 'UC16']) {
    const k = ranKinds(go(id));
    assert.deepEqual(k.slice(-2), ['gateway-check', 'tool-refused'], id); assert.ok(!k.includes('authorize-decision'), id);
  }
});

test('brain and said: the prompt hop carries what was typed, the agent names the brain, and nothing else repeats the words', () => {
  const said = 'how much money do I have <script>alert(1)</script>\u0000\u001b[31m';
  for (const brain of ['scripted', 'llama']) {
    const r = go('UC1', 'banking', { brain, said });
    assert.equal(r.outcome, 'PERMIT');
    assert.equal(r.hops.find((h) => h.kind === 'prompt').request.body.message, said);
    const text = JSON.stringify(r);
    assert.equal(text.split(JSON.stringify(said).slice(1, -1)).length - 1, 1, 'said appears once: on the prompt hop');
    assert.ok(!text.includes('<script>alert(1)') || r.hops.filter((h) => JSON.stringify(h).includes('<script>')).map((h) => h.kind).join() === 'prompt');
    const routing = brain === 'llama' ? 'llama.cpp picked UC1 (local model, mock run)' : 'Scripted intent match';
    assert.equal(r.hops.find((h) => h.kind === 'agent-receive').response.body.routing, routing);
    assert.match(r.hops.find((h) => h.kind === 'llm-plan').note, new RegExp(`^${routing.replace(/[().]/g, '\\$&')}`));
  }
  // No said: the chip text, as before.
  assert.equal(go('UC1').hops.find((h) => h.kind === 'prompt').request.body.message, 'show my balance');
});
