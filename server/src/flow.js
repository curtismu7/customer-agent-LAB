// The mock engine: one pure, deterministic function per run. runUseCase(uc, input) builds an ordered list of hops from the use case's evidence chain
// (user sign-in persona, consent if needed, token exchange / OBO with an act chain, gateway check, authorize decision, tool dispatch or refusal),
// each with the raw request and response, a W3C traceparent, and MOCK tokens; the final outcome is COMPUTED from those hops by policy.js and the
// gateway rules below, never read from the manifest. No clock, no random, no I/O, no network. (The one non-deterministic byte string is the ECDSA
// signature inside a mock token: Node's ECDSA is randomised. Everything else repeats exactly.)
import { createHash } from 'node:crypto';
import { fill, personaOf, roleOf, toolFor } from './cast.js';
import { LABELS } from './data.js';
import { verifyMockJwt, signMockJwt, tokenView } from './mockjwt.js';
import { GATEWAY, decide, edgePolicy } from './policy.js';
import { situationOf } from './situations.js';
import { formatTraceparent, newTrace } from './trace.js';
import { enrichHop } from './vendor/hopDetail.mjs';
import HOP_CATALOG from './vendor/hop-catalog.json' with { type: 'json' };

export const ENGINE_OUTCOMES = new Set(['PERMIT', 'DENY', 'DENY_401', 'DENY_403', 'DENY_429', 'DENY_503', 'STEP_UP', 'HITL_REQUIRED', 'PERMIT_THEN_DENY', 'DELEGATE_AND_EXECUTE']);
const T0 = 1767225600; // 2026-01-01T00:00:00Z, the lab's fixed clock
const TTL = 300;
const SCOPE_FOR_ROLE = { read: 'accounts:read', write: 'transfers:write', sensitive: 'accounts:sensitive', a2a: 'portfolio:read' };
const sha = (s, n = 16) => createHash('sha256').update(String(s)).digest('hex').slice(0, n);

// A use case is computed by the engine when its outcome is one the engine can produce and it has something to compute (not a bare learning link).
export function isFlow(uc) {
  const s = situationOf(uc.id);
  return ENGINE_OUTCOMES.has(uc.expectedOutcome) && !(uc.track === 'learn' && uc.evidence.tokenChain.length === 0) && (uc.evidence.tokenChain.length > 0 || Array.isArray(s.chain) || uc.trigger.type !== 'link');
}
export const chainOf = (uc) => (Array.isArray(situationOf(uc.id).chain) ? situationOf(uc.id).chain : uc.evidence.tokenChain);

function makeCtx(uc, { cast, vertical, persona, traceparent, seed }) {
  const sit = situationOf(uc.id);
  const person = personaOf(cast, persona || sit.persona || 'standard');
  // A use case with no primary tool in the catalog is run against the vertical's everyday read tool (lab reading).
  const role = uc.primaryTool ? roleOf(uc.primaryTool) : 'read';
  const tool = uc.primaryTool ? toolFor(cast, uc.primaryTool) : cast.castReadTool;
  const trace = newTrace(traceparent, `${seed}:${uc.id}:${vertical}:${person.key}`);
  const host = cast.castHost;
  const ctx = {
    uc, cast, vertical, sit, person, role, tool, trace, hops: [], tokens: [], clock: T0, halted: null, pending: null, probeDenied: false,
    amount: typeof sit.amount === 'number' ? sit.amount : undefined, event: sit.event || null, gwDone: false, seenProofs: new Set(),
    urls: { idp: 'https://idp.mock.example/as', bff: `https://bff.${host}.example`, gw: `https://gateway.${host}.example`, mcp: `https://mcp.${host}.example`, registry: `https://registry.${host}.example`, a2a: `https://a2a.${host}.example` },
    scope: SCOPE_FOR_ROLE[role] || `tools:${tool || 'none'}`,
    agent: { id: cast.castAgent, label: cast.castAgent }, agents: [],
    user: null, exchanged: null, // the user token and the latest exchanged token (signed views)
  };
  ctx.rootSpan = trace.span();
  return ctx;
}

const label = (ctx, key, extra = {}) => fill(LABELS[key], { ...ctx.cast, ...extra });

function hop(ctx, key, { from, to, method = 'POST', url, headers = {}, body, status = 200, resBody, resHeaders = {}, note, verdict = 'ok', extraLabel, detail } = {}) {
  if (detail) (ctx.details ??= {})[ctx.hops.length + 1] = detail;
  const span = ctx.trace.span();
  const tp = formatTraceparent(ctx.trace.traceId, span);
  ctx.hops.push({
    n: ctx.hops.length + 1, kind: key, label: label(ctx, key, extraLabel), from, to, mock: true, verdict, note: note ? fill(note, ctx.cast) : undefined,
    traceparent: tp,
    request: { method, url, headers: { traceparent: tp, ...headers }, ...(body !== undefined ? { body } : {}) },
    response: { status, headers: resHeaders, body: resBody },
  });
  ctx.clock += 1;
}

function mint(ctx, name, claims, typ) {
  const iat = ctx.clock;
  const payload = { iss: ctx.urls.idp, iat, nbf: iat, exp: iat + TTL, jti: sha(`${ctx.trace.traceId}:${name}:${ctx.tokens.length}`), ...claims };
  const signed = signMockJwt(payload, typ ? { typ } : undefined);
  const view = tokenView(name, signed);
  ctx.tokens.push(view);
  return view;
}

const halt = (ctx, outcome, by, status, reason) => { if (!ctx.halted) ctx.halted = { outcome, by, status, reason }; };

// ---- step builders ---------------------------------------------------------------------------------------------------------------------------------
function signIn(ctx) {
  const p = ctx.person;
  const scope = 'openid accounts:read transfers:write accounts:sensitive portfolio:read';
  const t = mint(ctx, 'user token (MOCK)', { sub: p.sub, aud: 'customer-app-mock', scope, groups: p.groups, amr: ['pwd'], azp: 'customer-app-mock' }, 'JWT');
  ctx.user = t;
  hop(ctx, 'sign-in', {
    from: 'browser', to: 'idp', url: `${ctx.urls.idp}/flows/mock-signin`, headers: { 'content-type': 'application/json' },
    body: { persona: p.key, signIn: 'mock persona picker (pi.flow style); no password is asked or stored' },
    resBody: { status: 'COMPLETED', access_token: t.raw, token_type: 'Bearer', expires_in: TTL, scope }, extraLabel: { castPersona: p.sub },
  });
}

function consent(ctx) {
  hop(ctx, 'consent', {
    from: 'browser', to: 'idp', url: `${ctx.urls.idp}/consents`, body: { sub: ctx.person.sub, actor: ctx.agent.id, scopes: [ctx.scope], may_act: { sub: ctx.agent.id } },
    resBody: { granted: true, may_act: { sub: ctx.agent.id }, scopes: [ctx.scope] },
  });
}

// Consent (may_act) is asked once per run, before the first exchange, unless the enterprise IdP's group policy replaces it (the enterprise-managed flag).
function needConsent(ctx) {
  if (ctx.consented) return;
  ctx.consented = true;
  if (ctx.uc.flag !== 'ff_enterprise_managed_mcp_auth') consent(ctx);
}

function actorToken(ctx, agentId, name) {
  const t = mint(ctx, `${name} actor token (MOCK)`, { sub: agentId, aud: ctx.urls.idp, client_id: agentId, scope: 'exchange' }, 'JWT');
  ctx.agents.push({ id: agentId, token: t });
  hop(ctx, 'actor-token', {
    from: 'bff', to: 'idp', url: `${ctx.urls.idp}/token`, body: { grant_type: 'client_credentials', client_id: agentId, client_secret: '[mock client; no secret is shown or kept]' },
    resBody: { access_token: t.raw, token_type: 'Bearer', expires_in: TTL }, extraLabel: { agentName: agentId },
  });
  return t;
}

// RFC 8693. subject: the token being exchanged; actorTok: the agent's token (or null when staging a missing act claim).
function exchange(ctx, { subject, actorTok, actChain, audience, scope, key = 'token-exchange', sub }) {
  const aud = ctx.event === 'wrong-aud' ? 'https://other-service.example' : audience;
  const claims = { sub, aud, scope, client_id: actChain?.sub || undefined, ...(actChain ? { act: actChain } : {}) };
  if (ctx.event === 'insufficient-scope') claims.scope = 'openid';
  if (ctx.event === 'tampered-intent-token') claims.intent = 'transfer:limited';
  if (ctx.event === 'dpop-replay') claims.cnf = { jkt: sha(`${ctx.trace.traceId}:dpop-key`, 43) };
  const t = mint(ctx, `exchanged token (MOCK)`, claims, 'at+jwt');
  ctx.exchanged = t;
  ctx.exchangedClaims = claims;
  hop(ctx, key, {
    from: 'bff', to: 'idp', url: `${ctx.urls.idp}/token`,
    body: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: subject.raw, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', ...(actorTok ? { actor_token: actorTok.raw, actor_token_type: 'urn:ietf:params:oauth:token-type:access_token' } : {}), audience: aud, scope: claims.scope },
    resBody: { access_token: t.raw, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: TTL, scope: claims.scope },
    note: actChain ? `act claim names the agent: ${JSON.stringify(actChain)}` : 'no actor token was sent, so the token has no act claim',
    detail: { before: subject.claims, after: claims, kv: [['grant_type', 'token-exchange'], ['subject_token_type', 'access_token'], ...(actorTok ? [['actor_token_type', 'access_token']] : [])] },
  });
}

function exchangeOnce(ctx) {
  const actor = ctx.event === 'impersonation-no-act' ? null : ctx.agents[0]?.token || actorToken(ctx, ctx.agent.id, 'agent');
  const act = actor ? { sub: ctx.agent.id } : null;
  exchange(ctx, { subject: ctx.user, actorTok: actor, actChain: act, audience: ctx.urls.mcp, scope: ctx.scope, sub: ctx.person.sub });
}

// The gateway check (RFC 9728-style resource gateway): validates the token it is handed, then the edge policy. Returns true when the call may continue.
function gatewayCheck(ctx, { again = false, key = 'gateway-check' } = {}) {
  ctx.gwDone = true;
  const tok = ctx.exchanged || ctx.user;
  const claims = ctx.exchangedClaims || (ctx.user && ctx.user.claims) || {};
  const agentMediated = Boolean(ctx.exchanged) || ctx.event === 'impersonation-no-act' || ctx.uc.evidence.tokenChain.some((s) => s.startsWith('a2a-'));
  const checks = [];
  let verdict = null; // { outcome, status, error }
  const fail = (outcome, status, error, why) => { checks.push({ check: error, ok: false, why }); if (!verdict) verdict = { outcome, status, error }; };
  const pass = (check) => checks.push({ check, ok: true });
  const sig = ctx.event === 'tampered-intent-token' ? { ok: false } : verifyMockJwt(tok.raw);
  const overload = ctx.event === 'rate-limit-burst' ? (ctx.sit.burst || GATEWAY.rateLimit + 1) : 1;

  if (ctx.event === 'introspection-down') fail('DENY_503', 503, 'validation_unavailable', 'the token validation endpoint did not answer (simulated, no network); the gateway fails closed');
  else if (!sig.ok) fail('DENY_401', 401, 'invalid_signature', 'the token signature does not verify');
  else pass('signature');
  if (!verdict) { if (claims.aud && ![ctx.urls.mcp, 'customer-app-mock'].includes(claims.aud)) fail('DENY_401', 401, 'invalid_audience', 'aud does not name this gateway'); else pass('aud'); }
  if (!verdict && agentMediated && !claims.act) fail('DENY_401', 401, 'missing_act', 'an agent-mediated call must carry an act claim');
  else if (!verdict && agentMediated) pass('act');
  if (!verdict && claims.cnf?.jkt) {
    const proof = sha(`${ctx.trace.traceId}:dpop-proof`, 12);
    if (ctx.seenProofs.has(proof)) fail('DENY_401', 401, 'invalid_dpop_proof', 'this DPoP proof (jti) was already used');
    else { ctx.seenProofs.add(proof); pass('dpop-proof-fresh'); }
  }
  if (!verdict && ctx.event === 'rate-limit-burst') { if (overload > GATEWAY.rateLimit) fail('DENY_429', 429, 'rate_limited', `call ${overload} in the window; the limit is ${GATEWAY.rateLimit} per 60 s`); else pass('rate'); }
  if (!verdict && ctx.exchanged) { if (!String(claims.scope || '').split(' ').includes(ctx.scope)) fail('DENY_403', 403, 'insufficient_scope', `the token does not carry ${ctx.scope}`); else pass('scope'); }
  if (!verdict && ctx.sit.args) { const why = edgePolicy(ctx.uc.primaryTool, ctx.sit.args); if (why) fail('DENY', 403, 'policy_denied', `edge policy: ${why}`); else pass('edge-policy'); }

  const denied = verdict;
  hop(ctx, key, {
    from: 'bff', to: 'gateway', url: `${ctx.urls.gw}/mcp`, headers: { authorization: `Bearer ${tok.raw}`, ...(claims.cnf ? { dpop: `proof.${sha(`${ctx.trace.traceId}:dpop-proof`, 12)}` } : {}) },
    body: { jsonrpc: '2.0', method: 'tools/call', params: { name: ctx.tool, ...(ctx.sit.args ? { arguments: ctx.sit.args } : {}) } },
    status: denied ? denied.status : 200, verdict: denied ? 'deny' : 'ok',
    resBody: denied ? { error: denied.error, checks } : { forwarded: true, checks },
    resHeaders: denied && denied.status === 429 ? { 'retry-after': '60' } : {},
    extraLabel: { again: again ? ' (second use)' : '' },
    detail: { stages: gatewayStages(checks, claims, ctx) },
  });
  if (denied) halt(ctx, denied.outcome, 'gateway', denied.status, denied.error);
  return !denied;
}
// The gateway filter chain as step-detail stages: one row per check the gateway ran, in order; the failing one says why and stops the chain.
const STAGE_NAMES = { signature: 'Signature', invalid_signature: 'Signature', validation_unavailable: 'Token validation', aud: 'Audience', invalid_audience: 'Audience', act: 'act present', missing_act: 'act present', 'dpop-proof-fresh': 'DPoP proof', invalid_dpop_proof: 'DPoP proof', rate: 'Rate limit', rate_limited: 'Rate limit', scope: 'Scope', insufficient_scope: 'Scope', 'edge-policy': 'Edge policy', policy_denied: 'Edge policy' };
function gatewayStages(checks, claims, ctx) {
  const note = { aud: claims.aud, act: claims.act?.sub, scope: ctx.scope, signature: 'mock key' };
  return checks.map((c) => ({ name: STAGE_NAMES[c.check] ?? c.check, result: c.ok ? 'pass' : 'fail', note: c.ok ? (note[c.check] ? String(note[c.check]) : '') : `${c.why} (stopped here)` }));
}

// demo-hop/1: add the teaching fields from the shared hop catalog. Mock runs keep MOCK tokens raw (rulebook); secrets stay write-only.
const enrichAll = (ctx) => ctx.hops.map((h) => enrichHop(h, HOP_CATALOG, ctx.details?.[h.n], { tokens: 'raw' }));

const ensureGateway = (ctx) => {
  if (ctx.halted || ctx.gwDone || ctx.sit.public || !ctx.uc.needs.includes('gw')) return;
  gatewayCheck(ctx);
};

function authorize(ctx) {
  if (ctx.halted || ctx.authorized) return;
  ctx.authorized = true;
  ensureGateway(ctx);
  if (ctx.halted) return;
  const act = ctx.exchangedClaims?.act;
  const actorUnregistered = ctx.event === 'rogue-actor';
  const dec = decide({
    role: ctx.role, tool: ctx.uc.primaryTool, amount: ctx.amount, sub: ctx.person.sub, owner: ctx.event === 'cross-owner-account' ? ctx.cast.castOwner2 : ctx.person.sub,
    groupGate: ctx.sit.groupGate, groups: ctx.person.groups, group: ctx.cast.castGroup, actor: actorUnregistered ? { registered: false } : { registered: true }, rar: ctx.sit.rar,
  });
  hop(ctx, 'authorize-decision', {
    from: 'gateway', to: 'authorize', url: 'https://authorize.mock.example/decision',
    body: { subject: ctx.person.sub, action: ctx.tool, context: { amount: ctx.amount, groups: ctx.person.groups, act: actorUnregistered ? { sub: 'unregistered-agent' } : act, ...(ctx.sit.rar ? { authorization_details: [{ type: 'payment', maxAmount: ctx.sit.rar.maxAmount }] } : {}), ...(ctx.sit.forgedApproval ? { hitl_approved: true } : {}) } },
    resBody: { decision: dec.decision === 'DENY_403' ? 'DENY' : dec.decision, reason: dec.reason, ...(['STEP_UP', 'HITL_REQUIRED', 'CIBA'].includes(dec.decision) ? { obligation: dec.decision } : {}) },
    verdict: dec.decision === 'PERMIT' ? 'ok' : ['STEP_UP', 'HITL_REQUIRED', 'CIBA'].includes(dec.decision) ? 'obligation' : 'deny',
    note: ctx.sit.forgedApproval ? 'the client sent a boolean "approved" flag; the BFF ignores it and needs a real, verified receipt' : undefined,
    detail: { decision: { outcome: dec.decision, by: 'authorize policy (mock)', reasons: [dec.reason].filter(Boolean) } },
  });
  if (dec.decision === 'DENY' || dec.decision === 'DENY_403') halt(ctx, dec.decision, 'authorize', 403, dec.reason);
  else if (dec.decision !== 'PERMIT') ctx.pending = dec.decision;
}

function held(ctx) {
  if (ctx.heldShown) return;
  ctx.heldShown = true;
  hop(ctx, 'tool-held', { from: 'gateway', to: 'mcp', url: `${ctx.urls.mcp}/mcp`, status: 202, verdict: 'held', resBody: { dispatched: false, waiting_for: ctx.pending, note: 'the write is held until the obligation is satisfied' } });
}

function dispatch(ctx) {
  if (ctx.halted) return refusal(ctx);
  ensureGateway(ctx);
  // The gateway asks Authorize before it dispatches. A chain whose evidence has no authorize step still gets the decision when the use case needs authz.
  if (!ctx.halted && !ctx.sit.public && ctx.uc.needs.includes('authz')) authorize(ctx);
  if (ctx.halted) return refusal(ctx);
  if (ctx.pending && ctx.pending !== 'CIBA') return held(ctx);
  const publicCall = ctx.sit.public;
  hop(ctx, 'tool-dispatched', {
    from: 'gateway', to: 'mcp', url: `${ctx.urls.mcp}/mcp`, headers: publicCall ? {} : { authorization: `Bearer ${(ctx.exchanged || ctx.user).raw}` },
    body: { jsonrpc: '2.0', method: 'tools/call', params: { name: ctx.tool, ...(ctx.sit.args ? { arguments: ctx.sit.args } : {}) } },
    resBody: { result: { tool: ctx.tool, isError: false, content: [{ type: 'text', text: `mock result of ${ctx.tool} for ${ctx.cast.castAsset} data (synthetic)` }] } },
    note: publicCall ? 'public catalog call: no token, no authorize, no gateway check' : undefined,
  });
}

function refusal(ctx) {
  if (ctx.refused) return;
  ctx.refused = true;
  const h = ctx.halted;
  hop(ctx, 'tool-refused', { from: h.by, to: 'bff', url: `${ctx.urls.bff}/api/tool-result`, status: h.status, verdict: 'deny', resBody: { dispatched: false, refused_by: h.by, outcome: h.outcome, reason: h.reason } });
}

function a2aExchange(ctx, n) {
  const a = ctx.agents[n - 1];
  const prior = n === 1 ? ctx.user : ctx.exchanged;
  const chain = n === 1 ? { sub: a.id } : { sub: a.id, act: ctx.exchangedClaims.act };
  const scope = n === 1 ? ctx.scope : ctx.scope; // narrowing is shown by dropping 'exchange' and openid
  exchange(ctx, { subject: prior, actorTok: a.token, actChain: chain, audience: n === 2 ? ctx.urls.mcp : ctx.urls.a2a, scope, key: n === 1 ? 'a2a-exchange-1' : 'a2a-exchange-2', sub: ctx.person.sub });
}

const STEPS = {
  'user-token': (ctx) => { if (!ctx.user) signIn(ctx); },
  'token-exchange': (ctx) => { needConsent(ctx); exchangeOnce(ctx); },
  'authorize-decision': authorize,
  'tool-dispatched': dispatch,
  'a2a-agent1-actor': (ctx) => { ctx.agent = { id: ctx.cast.castAgent, label: ctx.cast.castAgent }; actorToken(ctx, ctx.cast.castAgent, 'first agent'); },
  'a2a-exchange1': (ctx) => { needConsent(ctx); a2aExchange(ctx, 1); },
  'a2a-agent2-actor': (ctx) => { actorToken(ctx, ctx.cast.castAgent2, 'specialist'); },
  'a2a-exchange2': (ctx) => a2aExchange(ctx, 2),
  'a2a-mismatch-probe': (ctx) => {
    if (ctx.halted) return;
    const dec = decide({ role: ctx.role, tool: ctx.uc.primaryTool, sub: ctx.person.sub, groups: ctx.person.groups, actor: { registered: false } });
    hop(ctx, 'a2a-mismatch-probe', { from: 'gateway', to: 'authorize', url: 'https://authorize.mock.example/decision', body: { subject: ctx.person.sub, action: ctx.tool, context: { act: { sub: ctx.cast.castAgent3, act: { sub: ctx.cast.castAgent } } } }, resBody: { decision: dec.decision === 'PERMIT' ? 'PERMIT' : 'DENY', reason: dec.reason }, verdict: dec.decision === 'PERMIT' ? 'ok' : 'deny', status: dec.decision === 'PERMIT' ? 200 : 403 });
    if (dec.decision !== 'PERMIT') ctx.probeDenied = true;
  },
  'a2a-protocol-bearer': (ctx) => hop(ctx, 'a2a-protocol-bearer', { from: 'agent', to: 'a2a', method: 'POST', url: `${ctx.urls.a2a}/a2a`, headers: { authorization: `Bearer ${ctx.exchanged.raw}` }, resBody: { note: 'the nested-act token is the bearer for the A2A call' } }),
  'a2a-agent-card': (ctx) => hop(ctx, 'a2a-agent-card', { from: 'agent', to: 'a2a', method: 'GET', url: `${ctx.urls.a2a}/.well-known/agent-card.json`, resBody: { name: ctx.cast.castAgent2, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, skills: [{ id: ctx.tool, name: ctx.tool }] } }),
  'a2a-protocol-message': (ctx) => hop(ctx, 'a2a-protocol-message', { from: 'agent', to: 'a2a', url: `${ctx.urls.a2a}/a2a`, headers: { authorization: `Bearer ${ctx.exchanged.raw}` }, body: { jsonrpc: '2.0', method: 'message/send', params: { message: { role: 'user', parts: [{ kind: 'text', text: `run ${ctx.tool}` }] } } }, resBody: { result: { kind: 'task', status: { state: 'completed' } } } }),
  'ciba-poll': (ctx) => {
    if (ctx.halted) return;
    const id = sha(`${ctx.trace.traceId}:ciba`, 12);
    hop(ctx, 'ciba-authorize', { from: 'bff', to: 'idp', url: `${ctx.urls.idp}/bc-authorize`, body: { login_hint: ctx.person.sub, binding_message: 'APPROVE', scope: ctx.scope }, resBody: { auth_req_id: id, expires_in: 120, interval: 5 } });
    hop(ctx, 'ciba-poll', { from: 'bff', to: 'idp', url: `${ctx.urls.idp}/token`, body: { grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: id }, resBody: { access_token: mint(ctx, 'ciba token (MOCK)', { sub: ctx.person.sub, aud: ctx.urls.mcp, scope: ctx.scope, amr: ['pwd', 'mfa'] }, 'at+jwt').raw, note: 'the user approved on the mock phone' } });
    if (ctx.pending === 'CIBA') ctx.pending = null;
  },
  'hitl-receipt': (ctx) => { if (!ctx.halted) hop(ctx, 'hitl-receipt', { from: 'bff', to: 'hitl', url: `${ctx.urls.bff}/api/hitl/receipt`, status: 404, verdict: 'held', resBody: { receipt: null, state: 'pending', note: 'no verified approval receipt yet; the human has not approved' } }); },
  'sim-exchange-ok': exchangeOnce,
  'sim-gateway-deny': (ctx) => { if (!ctx.halted) gatewayCheck(ctx, { again: ctx.seenProofs.size > 0 }); if (ctx.halted) refusal(ctx); },
  'sim-replay-start': (ctx) => { exchangeOnce(ctx); gatewayCheck(ctx); },
  'sim-rar-armed': (ctx) => hop(ctx, 'sim-rar-armed', { from: 'bff', to: 'idp', url: `${ctx.urls.idp}/par`, body: { response_type: 'code', authorization_details: [{ type: 'payment', maxAmount: ctx.sit.rar.maxAmount }] }, resBody: { request_uri: `urn:mock:par:${sha(ctx.trace.traceId, 10)}`, expires_in: 60 } }),
  'sim-rar-grant': (ctx) => { exchangeOnce(ctx); },
  'intent-binding-verified': (ctx) => { const dec = decide({ role: null, amount: ctx.amount, rar: ctx.sit.rar, actor: { registered: true } }); hop(ctx, 'intent-binding-verified', { from: 'gateway', to: 'authorize', url: 'https://authorize.mock.example/decision', body: { amount: ctx.amount, authorization_details: [{ type: 'payment', maxAmount: ctx.sit.rar.maxAmount }] }, resBody: { decision: dec.decision, reason: dec.reason }, verdict: dec.decision === 'PERMIT' ? 'ok' : 'deny' }); if (dec.decision !== 'PERMIT') halt(ctx, dec.decision, 'authorize', 403, dec.reason); },
  'exchange-skipped': (ctx) => { hop(ctx, 'exchange-skipped', { from: 'bff', to: 'gateway', url: `${ctx.urls.bff}/api/tool`, status: 403, verdict: 'deny', headers: {}, resBody: { error: 'user_token_forwarding_disabled', note: 'the BFF refuses to hand the raw user token to a tool; it must exchange first (fail closed)' } }); halt(ctx, 'DENY_403', 'bff', 403, 'user_token_forwarding_disabled'); },
  'gateway-permit': (ctx) => { if (!ctx.halted) { ctx.exchanged = ctx.exchanged || ctx.user; gatewayCheck(ctx, { key: 'gateway-check' }); } },
  'privilege-gateway-leg': (ctx) => hop(ctx, 'privilege-gateway-leg', { from: 'bff', to: 'privilege', url: 'https://privilege.mock.example/gateway', headers: { authorization: `Bearer ${(ctx.exchanged || ctx.user).raw}` }, resBody: { accepted: true } }),
  'credential-swap': (ctx) => { const t = mint(ctx, 'operator credential (MOCK)', { sub: 'operator-service-mock', aud: ctx.urls.mcp, scope: ctx.scope }, 'at+jwt'); hop(ctx, 'credential-swap', { from: 'privilege', to: 'mcp', url: `${ctx.urls.mcp}/mcp`, headers: { authorization: `Bearer ${t.raw}` }, resBody: { swapped: true, note: 'the caller bearer is swapped for the operator credential before the call leaves' } }); },
  'enterprise-managed-mode': (ctx) => hop(ctx, 'enterprise-managed-mode', { from: 'bff', to: 'idp', url: `${ctx.urls.idp}/group-policy`, body: { sub: ctx.person.sub, group: ctx.cast.castGroup }, resBody: { allowed: true, note: 'group policy decides issuance; no per-server consent screen' } }),
  'id-jag-issued': (ctx) => { const t = mint(ctx, 'ID-JAG (MOCK)', { sub: ctx.person.sub, aud: ctx.urls.mcp, scope: ctx.scope, jti: sha(`${ctx.trace.traceId}:idjag`, 16) }, 'oauth-id-jag+jwt'); ctx.idjag = t; hop(ctx, 'id-jag-issued', { from: 'bff', to: 'idp', url: `${ctx.urls.idp}/token`, body: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag', subject_token: ctx.user.raw }, resBody: { access_token: t.raw, issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag' } }); },
  'id-jag-redeemed': (ctx) => { const t = mint(ctx, 'MCP access token (MOCK)', { sub: ctx.person.sub, aud: ctx.urls.mcp, scope: ctx.scope }, 'at+jwt'); ctx.exchanged = t; ctx.exchangedClaims = t.claims; hop(ctx, 'id-jag-redeemed', { from: 'bff', to: 'mcp-as', url: `${ctx.urls.mcp}/token`, body: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: ctx.idjag.raw }, resBody: { access_token: t.raw, token_type: 'Bearer', note: 'single-use assertion; scoped to this one server' } }); },
  'verified-trust-issuance': (ctx) => { const t = mint(ctx, 'signed agent assertion (MOCK)', { sub: ctx.cast.castAgent, act_for: ctx.person.sub, vct: 'agent-assertion' }, 'vc+sd-jwt'); hop(ctx, 'verified-trust-issuance', { from: 'agent', to: 'credentials', url: 'https://credentials.mock.example/issue', body: { agent: ctx.cast.castAgent, user: ctx.person.sub }, resBody: { credential: t.raw } }); },
  'personal-agent-lookup': (ctx) => hop(ctx, 'personal-agent-lookup', { from: 'bff', to: 'registry', method: 'GET', url: `${ctx.urls.registry}/agents/${encodeURIComponent(ctx.cast.castAgent)}`, resBody: { id: ctx.cast.castAgent, registered: true, owner: ctx.person.sub } }),
};
export const KNOWN_STEPS = Object.keys(STEPS);

function narrate(ctx, outcome) {
  return fill(LABELS.narration, { ...ctx.cast, castOutcome: outcome, castTitle: ctx.uc.title, castPersona: ctx.person.sub });
}

function finalOutcome(ctx) {
  if (ctx.halted) return ctx.halted.outcome;
  if (ctx.pending) return ctx.pending;
  if (ctx.probeDenied) return 'PERMIT_THEN_DENY';
  if (ctx.uc.needs.includes('llm') && ctx.uc.needs.includes('a2a')) return 'DELEGATE_AND_EXECUTE';
  return 'PERMIT';
}

export function liveNote(uc) {
  if (uc.maturity === 'needs-build') return { status: 'needs-build', message: 'The source marks this use case needs-build: it is lab-simulated here, not claimed to work in the product.' };
  if (uc.flag) return { status: 'needs-flag', needs: uc.flag, message: `Needs live feature ${uc.flag}. It runs in mock; the live run here reaches the identity provider only and does not exercise it.` };
  return { status: 'idp-only', message: 'Live mode runs the identity-provider hops only (discovery and the agent token); the rest of this use case is not run live.' };
}

export function runUseCase(uc, input) {
  const base = { schema: 'customer-agent-run/1', mode: 'mock', useCase: { id: uc.id, track: uc.track, title: uc.title, maturity: uc.maturity, flag: uc.flag }, vertical: input.vertical, expectedOutcome: uc.expectedOutcome, live: liveNote(uc), labSimulated: uc.maturity === 'needs-build' };
  if (!isFlow(uc)) {
    // Guided use case: the product shows its own page; the lab opens it and does not recompute the outcome (it is the catalog's label).
    const ctx = makeCtx(uc, input);
    const target = uc.trigger.type === 'link' ? uc.trigger.path : uc.trigger.type === 'edu' ? `panel:${uc.trigger.panel}` : uc.trigger.type;
    hop(ctx, 'guided', { from: 'browser', to: 'page', method: 'GET', url: String(target), resBody: { opens: uc.opens, linkOut: uc.linkOut, note: 'a guided page: the lab does not recompute this outcome; the label is the catalog\'s' } });
    return { ...base, kind: 'guided', computed: false, persona: ctx.person.key, outcome: uc.expectedOutcome, matchesExpected: null, hops: enrichAll(ctx), tokens: ctx.tokens, traceId: ctx.trace.traceId, traceparent: formatTraceparent(ctx.trace.traceId, ctx.rootSpan), narration: narrate(ctx, uc.expectedOutcome) };
  }
  const ctx = makeCtx(uc, input);
  if (!ctx.sit.public) signIn(ctx);
  for (const step of chainOf(uc)) {
    if (!Object.hasOwn(STEPS, step)) throw new Error('unknown evidence step');
    if (step === 'user-token' && ctx.user) continue;
    STEPS[step](ctx);
  }
  // Gateway-only events (rate limit, validation outage) on a chain that never reaches a dispatch step still meet the gateway.
  if (!ctx.halted && !ctx.gwDone && ctx.event && ctx.uc.needs.includes('gw')) gatewayCheck(ctx);
  if (ctx.halted) refusal(ctx);
  else if (ctx.pending && ctx.pending !== 'CIBA') held(ctx);
  const outcome = finalOutcome(ctx);
  return { ...base, kind: 'flow', computed: true, persona: ctx.person.key, outcome, matchesExpected: outcome === uc.expectedOutcome, hops: enrichAll(ctx), tokens: ctx.tokens, traceId: ctx.trace.traceId, traceparent: formatTraceparent(ctx.trace.traceId, ctx.rootSpan), narration: narrate(ctx, outcome) };
}
