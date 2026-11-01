import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { VERTICALS, STUB_VERTICALS } from '../src/cast.js';
import { runUseCase, isFlow, chainOf, KNOWN_STEPS, ENGINE_OUTCOMES } from '../src/flow.js';
import { decide, edgePolicy, BANDS } from '../src/policy.js';
import { verifyMockJwt } from '../src/mockjwt.js';
import { SITUATIONS } from '../src/situations.js';
import { maskText } from '../src/credentials.js';

const go = (id, vertical = 'banking', extra = {}) => runUseCase(findUseCase(id), { cast: VERTICALS[vertical], vertical, seed: 'run', ...extra });
// Flips every bit of the first signature byte, so the tampered token ALWAYS differs (replacing trailing characters can be a no-op in base64url).
const flipSignature = (jwt) => { const [h, p, sig] = jwt.split('.'); const b = Buffer.from(sig, 'base64url'); b[0] ^= 0xff; return `${h}.${p}.${b.toString('base64url')}`; };
const kinds = (r) => r.hops.map((h) => h.kind);
const strip = (r) => JSON.parse(JSON.stringify(r, (k, v) => (typeof v === 'string' ? v.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, (m) => m.split('.').slice(0, 2).join('.')) : v)));

test('all 87 use cases run in mock in all three full verticals and the COMPUTED outcome equals the manifest expectedOutcome', () => {
  let n = 0;
  for (const vertical of Object.keys(VERTICALS)) {
    for (const uc of MANIFEST.usecases) {
      const r = go(uc.id, vertical);
      assert.equal(r.outcome, uc.expectedOutcome, `${vertical}/${uc.id}`);
      assert.equal(r.matchesExpected, r.computed ? true : null, `${vertical}/${uc.id}`);
      n += 1;
    }
  }
  assert.equal(n, 87 * 3);
});

test('54 use cases are computed by the engine, 33 are guided pages whose outcome is the catalog label (and say so)', () => {
  const flows = MANIFEST.usecases.filter(isFlow);
  assert.equal(flows.length, 54);
  for (const uc of MANIFEST.usecases) {
    const r = go(uc.id);
    assert.equal(r.kind, isFlow(uc) ? 'flow' : 'guided', uc.id);
    assert.equal(r.computed, isFlow(uc), uc.id);
    if (!isFlow(uc)) { assert.deepEqual(kinds(r), ['guided']); assert.match(r.hops[0].response.body.note, /does not recompute/); }
  }
  for (const uc of MANIFEST.usecases.filter((u) => !isFlow(u))) assert.ok(!ENGINE_OUTCOMES.has(uc.expectedOutcome) || uc.id === 'UC-LEARN11', `${uc.id} is guided only because it is not an engine outcome (or a learn link)`);
});

test('the outcome is computed, not copied: staging a different persona or amount changes it', () => {
  assert.equal(go('UC21').outcome, 'PERMIT');
  const wrongPersona = go('UC21', 'banking', { persona: 'standard' });
  assert.equal(wrongPersona.outcome, 'DENY_403'); assert.equal(wrongPersona.matchesExpected, false);
  assert.equal(go('UC9', 'banking', { persona: 'premium' }).outcome, 'PERMIT');
  assert.equal(go('UC9').outcome, 'DENY_403');
});

test('every distinct evidence step has a builder, and an unknown step throws instead of being skipped', () => {
  const steps = new Set(MANIFEST.usecases.flatMap((u) => chainOf(u)));
  for (const s of steps) assert.ok(KNOWN_STEPS.includes(s), s);
  const fake = { ...findUseCase('UC1'), evidence: { tokenChain: ['user-token', 'made-up-step'], activity: [] } };
  assert.throws(() => runUseCase(fake, { cast: VERTICALS.banking, vertical: 'banking', seed: 'x' }), /unknown evidence step/);
});

test('a run is deterministic: two runs match exactly apart from the ECDSA signature bytes', () => {
  for (const id of ['UC1', 'UC2.6', 'UC12', 'UC48', 'UC-LEARN1']) assert.deepEqual(strip(go(id)), strip(go(id)), id);
  assert.notEqual(go('UC1').traceId, go('UC6').traceId);
  assert.notEqual(go('UC1', 'banking').traceId, go('UC1', 'retail').traceId);
});

test('W3C traceparent on EVERY hop: one trace id per run, a new span id per hop, flags 01', () => {
  for (const uc of MANIFEST.usecases) {
    const r = go(uc.id);
    const spans = new Set();
    for (const h of r.hops) {
      assert.match(h.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/, `${uc.id} hop ${h.n}`);
      assert.equal(h.request.headers.traceparent, h.traceparent);
      assert.equal(h.traceparent.split('-')[1], r.traceId);
      spans.add(h.traceparent.split('-')[2]);
    }
    assert.equal(spans.size, r.hops.length, `${uc.id}: span ids are unique`);
    assert.match(r.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  }
});

test('a valid incoming traceparent continues its trace; a malformed one starts a new one', () => {
  const tp = `00-${'ab'.repeat(16)}-${'cd'.repeat(8)}-01`;
  assert.equal(go('UC1', 'banking', { traceparent: tp }).traceId, 'ab'.repeat(16));
  assert.notEqual(go('UC1', 'banking', { traceparent: 'garbage' }).traceId, 'ab'.repeat(16));
  assert.notEqual(go('UC1', 'banking', { traceparent: `00-${'0'.repeat(32)}-${'cd'.repeat(8)}-01` }).traceId, '0'.repeat(32));
});

test('tokens are MOCK: labelled, ES256, verify against the mock key, decoded claims match, a tampered one fails', () => {
  for (const id of ['UC1', 'UC2', 'UC40', 'UC37', 'UC22', 'UC-MUSE2']) {
    const r = go(id);
    assert.ok(r.tokens.length > 0, id);
    for (const t of r.tokens) {
      assert.equal(t.mock, true); assert.match(t.label, /MOCK/); assert.match(t.notice, /MOCK token/);
      assert.equal(t.header.alg, 'ES256');
      const v = verifyMockJwt(t.raw); assert.equal(v.ok, true, `${id} ${t.label}`);
      assert.deepEqual(v.claims, t.claims);
      assert.equal(verifyMockJwt(flipSignature(t.raw)).ok, false);
    }
  }
});

test('UC1: the exchanged token carries act = the agent and sub = the customer; the user token has no act', () => {
  const r = go('UC1');
  const user = r.tokens.find((t) => /user token/.test(t.label)); const ex = r.tokens.find((t) => /exchanged/.test(t.label));
  assert.equal(user.claims.act, undefined);
  assert.equal(ex.claims.sub, user.claims.sub);
  assert.deepEqual(ex.claims.act, { sub: VERTICALS.banking.castAgent });
  assert.deepEqual(kinds(r), ['sign-in', 'consent', 'actor-token', 'token-exchange', 'gateway-check', 'authorize-decision', 'tool-dispatched']);
  assert.equal(r.hops.at(-1).request.body.params.name, 'get_account_balance');
});

test('A2A: the act chain is nested and scope is carried through; the second exchange names both agents', () => {
  const r = go('UC2');
  const final = r.tokens.filter((t) => /exchanged/.test(t.label)).at(-1);
  assert.deepEqual(final.claims.act, { sub: VERTICALS.banking.castAgent2, act: { sub: VERTICALS.banking.castAgent } });
  assert.deepEqual(kinds(r).filter((k) => k.startsWith('a2a')), ['a2a-exchange-1', 'a2a-exchange-2']);
  assert.equal(go('UC2.5').outcome, 'DELEGATE_AND_EXECUTE');
  const six = go('UC2.6');
  assert.equal(six.outcome, 'PERMIT_THEN_DENY');
  assert.deepEqual(kinds(six).slice(-2), ['tool-dispatched', 'a2a-mismatch-probe']);
  assert.equal(six.hops.at(-1).response.status, 403);
});

test('the persona changes the token subject and the group claim', () => {
  const std = go('UC1', 'banking', { persona: 'standard' }); const prem = go('UC1', 'banking', { persona: 'premium' });
  assert.equal(std.tokens[0].claims.sub, VERTICALS.banking.castUser); assert.deepEqual(std.tokens[0].claims.groups, []);
  assert.equal(prem.tokens[0].claims.sub, VERTICALS.banking.castUser2); assert.deepEqual(prem.tokens[0].claims.groups, [VERTICALS.banking.castGroup]);
});

test('denials stop the chain: no tool is dispatched, the last hop is a refusal with the right status', () => {
  const expected = { UC5: 403, UC6: 403, UC10: 403, UC11: 401, UC12: 401, UC13: 403, UC14: 403, UC15: 401, UC16: 401, UC16b: 403, UC18: 429, UC29: 503, UC31: 403, UC42: 403, UC9: 403 };
  for (const [id, status] of Object.entries(expected)) {
    const r = go(id);
    assert.ok(!kinds(r).includes('tool-dispatched'), id);
    assert.equal(r.hops.at(-1).kind, id === 'UC16b' ? 'tool-refused' : 'tool-refused', id);
    assert.equal(r.hops.at(-1).response.status, status, id);
    assert.match(r.outcome, /^DENY/);
  }
  assert.equal(go('UC18').hops.find((h) => h.response.status === 429).response.headers['retry-after'], '60');
});

test('obligations hold the write: STEP_UP and HITL_REQUIRED never dispatch; CIBA is satisfied by the poll and then dispatches', () => {
  for (const id of ['UC7', 'UC8', 'UC27', 'UC48']) { const r = go(id); assert.ok(!kinds(r).includes('tool-dispatched'), id); assert.equal(kinds(r).at(-1), 'tool-held'); assert.equal(r.hops.at(-1).response.status, 202); }
  const ciba = go('UC22');
  assert.deepEqual(kinds(ciba).slice(-3), ['ciba-authorize', 'ciba-poll', 'tool-dispatched']);
  assert.equal(ciba.outcome, 'PERMIT');
  const forged = go('UC27');
  assert.equal(forged.outcome, 'STEP_UP');
  assert.equal(forged.hops.find((h) => h.kind === 'authorize-decision').request.body.context.hitl_approved, true);
  assert.match(forged.hops.find((h) => h.kind === 'authorize-decision').note, /ignores it/);
  assert.equal(go('UC48').hops.find((h) => h.kind === 'hitl-receipt').response.body.receipt, null);
});

test('DPoP replay: the first proof passes and the second use is refused with invalid_dpop_proof', () => {
  const r = go('UC12');
  const checks = r.hops.filter((h) => h.kind === 'gateway-check');
  assert.equal(checks.length, 2);
  assert.equal(checks[0].response.status, 200); assert.equal(checks[1].response.status, 401);
  assert.equal(checks[1].response.body.error, 'invalid_dpop_proof');
  assert.equal(checks[0].request.headers.dpop, checks[1].request.headers.dpop);
  assert.match(checks[1].label, /second use/);
});

test('the gateway checks are real: a bad signature, audience, missing act, scope and a rate burst each give their own error', () => {
  const err = (id) => go(id).hops.find((h) => h.kind === 'gateway-check').response.body.error;
  assert.equal(err('UC15'), 'invalid_signature'); assert.equal(err('UC11'), 'invalid_audience'); assert.equal(err('UC16'), 'missing_act');
  assert.equal(err('UC5'), 'insufficient_scope'); assert.equal(err('UC18'), 'rate_limited'); assert.equal(err('UC29'), 'validation_unavailable');
  assert.equal(err('UC31'), 'policy_denied'); assert.equal(err('UC42'), 'policy_denied');
  const ok = go('UC1').hops.find((h) => h.kind === 'gateway-check').response.body.checks;
  assert.deepEqual(ok.map((c) => c.check), ['signature', 'aud', 'act', 'scope']);
});

test('the policy bands: every edge of every band (lab-invented thresholds)', () => {
  const at = (amount, tool = 'create_transfer', role = 'write') => decide({ role, tool, amount, sub: 's', groups: [], actor: { registered: true } }).decision;
  for (const [amount, want] of [[0, 'PERMIT'], [99, 'PERMIT'], [100, 'CIBA'], [199, 'CIBA'], [200, 'HITL_REQUIRED'], [499, 'HITL_REQUIRED'], [500, 'STEP_UP'], [1999, 'STEP_UP'], [2000, 'DENY'], [1e9, 'DENY']]) assert.equal(at(amount), want, String(amount));
  assert.equal(at(249, 'book_airline_flight', null), 'PERMIT'); assert.equal(at(250, 'book_airline_flight', null), 'HITL_REQUIRED');
  assert.equal(at(5000, 'get_account_balance', 'read'), 'PERMIT', 'a read tool has no money bands');
  assert.deepEqual(BANDS.money.map((b) => b.min), [2000, 500, 200, 100]);
});

test('every other policy rule on its own: unregistered actor, other owner, RAR bound, group gate', () => {
  const base = { role: 'read', tool: 'get_account_balance', sub: 'a', groups: [], actor: { registered: true } };
  assert.equal(decide({ ...base, actor: { registered: false } }).decision, 'DENY');
  assert.equal(decide({ ...base, owner: 'b' }).decision, 'DENY'); assert.equal(decide({ ...base, owner: 'a' }).decision, 'PERMIT');
  assert.equal(decide({ ...base, amount: 501, rar: { maxAmount: 500 } }).decision, 'DENY'); assert.equal(decide({ ...base, amount: 500, rar: { maxAmount: 500 } }).decision, 'PERMIT');
  assert.equal(decide({ ...base, groupGate: true, group: 'g' }).decision, 'DENY_403'); assert.equal(decide({ ...base, groupGate: true, group: 'g', groups: ['g'] }).decision, 'PERMIT');
  assert.equal(edgePolicy('get_weather', { state: 'TX' }), null); assert.ok(edgePolicy('get_weather', { state: 'FL' })); assert.ok(edgePolicy('get_weather', {}));
  assert.equal(edgePolicy('brave_news_search', { query: 'regional weather' }), null); assert.ok(edgePolicy('brave_news_search', { query: 'Bitcoin price' })); assert.ok(edgePolicy('brave_news_search', { query: 'my CRYPTO wallet' }));
  assert.equal(edgePolicy('other', { state: 'FL' }), null);
});

test('flag-gated use cases run in mock and say what live feature they need; UC15 is lab-simulated, not claimed', () => {
  for (const [id, flag] of [['UC12', 'ff_dpop'], ['UC14', 'ff_rar'], ['UC14b', 'ff_rar'], ['UC22', 'ciba_enabled'], ['UC25', 'ff_enterprise_managed_mcp_auth'], ['UC37', 'ff_verified_trust_a2a'], ['UC38', 'ff_personal_agent_concierge'], ['UC9', 'ff_authorize_group_policy']]) {
    const r = go(id);
    assert.equal(r.live.status, 'needs-flag', id); assert.equal(r.live.needs, flag, id); assert.match(r.live.message, new RegExp(`Needs live feature ${flag}`));
    assert.equal(r.mode, 'mock'); assert.ok(r.hops.length > 0);
  }
  const fifteen = go('UC15');
  assert.equal(fifteen.labSimulated, true); assert.equal(fifteen.live.status, 'needs-build'); assert.match(fifteen.live.message, /lab-simulated here, not claimed/);
  assert.equal(go('UC1').labSimulated, false); assert.equal(go('UC1').live.status, 'available-later');
});

test('the enterprise-managed flag replaces consent with group policy; ID-JAG is issued then redeemed', () => {
  assert.ok(!kinds(go('UC25')).includes('consent'));
  assert.deepEqual(kinds(go('UC40')), ['sign-in', 'enterprise-managed-mode', 'id-jag-issued', 'id-jag-redeemed']);
  assert.equal(go('UC40').tokens.find((t) => /ID-JAG/.test(t.label)).header.typ, 'oauth-id-jag+jwt');
});

test('the public catalog call needs no token and no sign-in', () => {
  const r = go('UC24');
  assert.deepEqual(kinds(r), ['tool-dispatched']); assert.equal(r.tokens.length, 0);
  assert.equal(r.hops[0].request.headers.authorization, undefined);
});

test('vertical packs: the tool follows the vertical for the same role, and no {{token}} is left unfilled in any run', () => {
  assert.equal(go('UC6', 'healthcare').hops.find((h) => h.kind === 'authorize-decision').request.body.action, 'pay_bill');
  assert.equal(go('UC6', 'retail').hops.find((h) => h.kind === 'authorize-decision').request.body.action, 'checkout');
  assert.equal(go('UC21', 'healthcare').hops.at(-1).request.body.params.name, 'sensitive_patient_records');
  assert.equal(go('UC33', 'retail').hops.at(-1).request.body.params.name, 'show_mortgage', 'a tool with no role passes through');
  for (const vertical of Object.keys(VERTICALS)) for (const uc of MANIFEST.usecases) assert.ok(!JSON.stringify(go(uc.id, vertical)).includes('{{'), `${vertical}/${uc.id}`);
});

test('every URL in every hop is a reserved host (.example or .invalid) and nothing in a run looks like another project', () => {
  for (const uc of MANIFEST.usecases) {
    const text = JSON.stringify(go(uc.id));
    for (const m of text.matchAll(/https?:\/\/([^/"\\\s]+)/g)) assert.match(m[1], /\.(example|invalid)$/, `${uc.id}: ${m[1]}`);
  }
});

test('the situation table names only real use cases, and the engine never reads expectedOutcome', () => {
  for (const id of Object.keys(SITUATIONS)) assert.ok(findUseCase(id), id);
  const uc = { ...findUseCase('UC6'), expectedOutcome: 'PERMIT' };
  const r = runUseCase(uc, { cast: VERTICALS.banking, vertical: 'banking', seed: 'x' });
  assert.equal(r.outcome, 'DENY'); assert.equal(r.matchesExpected, false);
});

test('only full verticals exist as packs; the stubs are names only', () => {
  assert.deepEqual(Object.keys(VERTICALS), ['banking', 'healthcare', 'retail']);
  assert.equal(Object.keys(STUB_VERTICALS).length, 7);
  assert.ok(!Object.keys(STUB_VERTICALS).includes('walbuy'));
});

test('review fix: a guided run does not claim a match (computed false, matchesExpected null, outcome is the catalog label); a computed run reports true or false', () => {
  const guided = MANIFEST.usecases.filter((uc) => !isFlow(uc));
  assert.equal(guided.length, 33);
  for (const uc of guided) { const r = go(uc.id); assert.equal(r.computed, false, uc.id); assert.equal(r.matchesExpected, null, uc.id); assert.equal(r.outcome, uc.expectedOutcome, uc.id); }
  for (const uc of MANIFEST.usecases.filter(isFlow)) assert.equal(typeof go(uc.id).matchesExpected, 'boolean', uc.id);
});

test('review fix: the gateway has no expiry check (the lab clock never reaches an expiry, so it was never exercised); no run names token_expired', () => {
  for (const uc of MANIFEST.usecases.filter(isFlow)) {
    const gw = go(uc.id).hops.filter((h) => h.kind === 'gateway-check');
    for (const h of gw) { assert.ok(!h.response.body.checks.some((c) => c.check === 'exp' || c.check === 'token_expired'), uc.id); assert.notEqual(h.response.body.error, 'token_expired', uc.id); }
  }
});

test('review fix: the MOCK token notice survives the response mask intact', () => {
  for (const id of ['UC1', 'UC7', 'UC2']) {
    for (const t of go(id).tokens) {
      assert.equal(t.notice, 'MOCK token, issued by this lab and signed with a public mock key');
      assert.equal(maskText(t.notice), t.notice); assert.ok(!t.notice.includes('[masked'), id);
    }
  }
});
