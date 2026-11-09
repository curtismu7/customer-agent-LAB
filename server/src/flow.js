// The mock engine: one pure, deterministic function per run. runUseCase(uc, input) builds an ordered list of hops in AI-DEMO2's reel order
// (buildTraceSteps): a frame (website, sign-in, prompt, agent, tools/list challenge and call, the agent's plan), then the use case's evidence chain
// (consent if needed, token exchange / OBO with an act chain, authorize decision, tools/call challenge, gateway check, tool dispatch and the API
// call, or a refusal), then the reply, then the steps AI-DEMO2 lists that this run did not take (verdict skip),
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

function makeCtx(uc, { cast, vertical, persona, traceparent, seed, brain, said }) {
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
    urls: { idp: 'https://idp.mock.example/as', bff: `https://bff.${host}.example`, agent: `https://agent.${host}.example`, llm: 'https://llm.mock.example', gw: `https://gateway.${host}.example`, mcp: `https://mcp.${host}.example`, api: `https://api.${host}.example`, registry: `https://registry.${host}.example`, a2a: `https://a2a.${host}.example` },
    scope: SCOPE_FOR_ROLE[role] || `tools:${tool || 'none'}`,
    agent: { id: cast.castAgent, label: cast.castAgent }, agents: [],
    user: null, exchanged: null, // the user token and the latest exchanged token (signed views)
  };
  ctx.brain = brain === 'llama' ? 'llama' : 'scripted';
  ctx.said = typeof said === 'string' ? said : undefined;
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
  ctx.exchangedVia = 'exchange';
  ctx.exchangedClaims = claims;
  hop(ctx, key, {
    from: 'bff', to: 'idp', url: `${ctx.urls.idp}/token`,
    body: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: subject.raw, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', ...(actorTok ? { actor_token: actorTok.raw, actor_token_type: 'urn:ietf:params:oauth:token-type:access_token' } : {}), audience: aud, scope: claims.scope },
    resBody: { access_token: t.raw, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: TTL, scope: claims.scope },
    note: actChain ? `act claim names the agent: ${JSON.stringify(actChain)}` : 'no actor token was sent, so the token has no act claim',
    detail: { before: subject.claims, after: t.claims, kv: [['grant_type', 'token-exchange'], ['subject_token_type', 'access_token'], ...(actorTok ? [['actor_token_type', 'access_token']] : [])] },
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
  // act is required on a token minted by a delegating exchange (RFC 8693). An access token redeemed from an ID-JAG has no act by design: the
  // ID-JAG grant is the user's own, scoped to this one server.
  const agentMediated = (Boolean(ctx.exchanged) && ctx.exchangedVia !== 'id-jag') || ctx.event === 'impersonation-no-act' || ctx.uc.evidence.tokenChain.some((s) => s.startsWith('a2a-'));
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

// Attack events the gateway catches (a bad signature, audience, act, scope, DPoP proof, rate or validation outage). DEVIATION from AI-DEMO2's order,
// kept on purpose: when one of these chains reaches Authorize, the gateway runs first, as the lab's attack chain always did. AI-DEMO2 draws these
// runs as a gateway error with Authorize not in the path, so the hops match it; the outcome is the gateway's either way.
const GATEWAY_STAGE_EVENTS = new Set(['tampered-intent-token', 'impersonation-no-act', 'wrong-aud', 'insufficient-scope', 'dpop-replay', 'rate-limit-burst', 'introspection-down']);
const WWW_AUTH = (ctx) => `Bearer realm="mcp", error="invalid_token", resource_metadata="${ctx.urls.gw}/.well-known/oauth-protected-resource"`;
const RESOURCE_METADATA = (ctx) => [['resource', `${ctx.urls.gw}/mcp`], ['authorization_servers', ctx.urls.idp], ['scopes_supported', Object.values(SCOPE_FOR_ROLE).join(' ')]];

// RFC 6750 §3 / RFC 9728 §5.1: the same request with no Authorization header gets 401 and a challenge naming the resource metadata. Nothing runs.
function challenge(ctx, key, method) {
  hop(ctx, key, {
    from: 'agent', to: 'gateway', url: `${ctx.urls.gw}/mcp`, headers: { 'content-type': 'application/json' },
    body: { jsonrpc: '2.0', id: 1, method, ...(method === 'tools/call' ? { params: { name: ctx.tool } } : {}) },
    status: 401, resHeaders: { 'www-authenticate': WWW_AUTH(ctx) }, resBody: { error: 'invalid_token', error_description: 'no bearer token' },
    note: 'a 401 is the expected answer: the caller sent no token, and the challenge says where the resource metadata is',
    detail: { kv: RESOURCE_METADATA(ctx) },
  });
}

// Per use case facts from AI-DEMO2's reel (source: buildTraceSteps.js @ 370725e51, per-use-case paths extracted 2026-11-09 into the owner's
// reel-spec; step names only). PLANS: the agent lists its tools and plans a call ('tools-list' and 'llm' done); UC-MUSE1/2 have no AI-DEMO2 reel
// run but call a tool in this lab, so they plan too. CALLS_TOOL: the run reaches the MCP server ('mcp' done). NO_CALL_CHALLENGE: 'mcp' done
// without 'tools-call-challenge'. API_KEY_PATH: 'vault-key-inject' and 'api-key-swap' done. A2A_PROTOCOL: 'a2a-agent-card' and
// 'a2a-protocol-message' done. DELEGATES: 'agent-token' and/or 'exchange' done (or active) in AI-DEMO2 although the lab's evidence chain has no
// exchange step; the agent token and the RFC 8693 exchange then run before the first Authorize or gateway call, as in AI-DEMO2.
const DELEGATES = new Set(['UC6', 'UC7', 'UC8', 'UC9', 'UC10', 'UC13', 'UC14', 'UC15', 'UC16', 'UC21', 'UC22', 'UC27', 'UC30', 'UC31', 'UC39', 'UC41', 'UC42']);
const PLANS = new Set(['UC1', 'UC2', 'UC2.5', 'UC2.6', 'UC3', 'UC4', 'UC6', 'UC7', 'UC8', 'UC9', 'UC17', 'UC19', 'UC20', 'UC21', 'UC22', 'UC24', 'UC25', 'UC27', 'UC28', 'UC30', 'UC31', 'UC33', 'UC34', 'UC35', 'UC37', 'UC38', 'UC39', 'UC40', 'UC41', 'UC42', 'UC44', 'UC45', 'UC48', 'UC-TOOL1', 'UC-MUSE1', 'UC-MUSE2']);
const CALLS_TOOL = new Set(['UC1', 'UC3', 'UC4', 'UC14b', 'UC17', 'UC19', 'UC20', 'UC21', 'UC22', 'UC24', 'UC25', 'UC28', 'UC30', 'UC33', 'UC34', 'UC38', 'UC39', 'UC40', 'UC41', 'UC44', 'UC45', 'UC48', 'UC-TOOL1']);
const NO_CALL_CHALLENGE = new Set(['UC14b']);
const API_KEY_PATH = new Set(['UC33']);
const A2A_PROTOCOL = new Set(['UC2', 'UC2.5', 'UC2.6', 'UC37']);
export const REEL_TABLES = { PLANS, CALLS_TOOL, NO_CALL_CHALLENGE, API_KEY_PATH, A2A_PROTOCOL, DELEGATES };

// The delegation AI-DEMO2 draws before the policy and the gateway: consent (unless enterprise-managed), the agent token and the exchange, once.
function ensureDelegated(ctx) {
  if (ctx.halted || ctx.exchanged || !ctx.user || ctx.sit.public || !DELEGATES.has(ctx.uc.id)) return;
  needConsent(ctx);
  exchangeOnce(ctx);
}

// A use case that reaches the MCP server in AI-DEMO2 goes through the gateway even when the lab's derived needs list leaves 'gw' out.
const gatewayApplies = (ctx) => !ctx.halted && !ctx.gwDone && !ctx.sit.public && (ctx.uc.needs.includes('gw') || CALLS_TOOL.has(ctx.uc.id));
// The authorized call: the tools/call challenge first (not on the gateway-stage attack chains, which AI-DEMO2 draws without it), then the gateway.
function gatewayLeg(ctx) {
  if (!gatewayApplies(ctx)) return;
  ensureDelegated(ctx);
  if (!GATEWAY_STAGE_EVENTS.has(ctx.event) && !NO_CALL_CHALLENGE.has(ctx.uc.id)) challenge(ctx, 'tools-call-challenge', 'tools/call');
  gatewayCheck(ctx);
}

function authorize(ctx) {
  if (ctx.halted || ctx.authorized) return;
  ctx.authorized = true;
  ensureDelegated(ctx);
  if (GATEWAY_STAGE_EVENTS.has(ctx.event) && gatewayApplies(ctx)) gatewayCheck(ctx);
  if (ctx.halted) return;
  const act = ctx.exchangedClaims?.act;
  const actorUnregistered = ctx.event === 'rogue-actor';
  const dec = decide({
    role: ctx.role, tool: ctx.uc.primaryTool, amount: ctx.amount, sub: ctx.person.sub, owner: ctx.event === 'cross-owner-account' ? ctx.cast.castOwner2 : ctx.person.sub,
    groupGate: ctx.sit.groupGate, groups: ctx.person.groups, group: ctx.cast.castGroup, actor: actorUnregistered ? { registered: false } : { registered: true }, rar: ctx.sit.rar,
  });
  hop(ctx, 'authorize-decision', {
    from: 'bff', to: 'authorize', url: 'https://authorize.mock.example/decision',
    body: { subject: ctx.person.sub, action: ctx.tool, context: { amount: ctx.amount, groups: ctx.person.groups, act: actorUnregistered ? { sub: 'unregistered-agent' } : act, ...(ctx.sit.rar ? { authorization_details: [{ type: 'payment', maxAmount: ctx.sit.rar.maxAmount }] } : {}), ...(ctx.sit.forgedApproval ? { hitl_approved: true } : {}) } },
    resBody: { decision: dec.decision === 'DENY_403' ? 'DENY' : dec.decision, reason: dec.reason, ...(['STEP_UP', 'HITL_REQUIRED', 'CIBA'].includes(dec.decision) ? { obligation: dec.decision } : {}) },
    verdict: dec.decision === 'PERMIT' ? 'ok' : ['STEP_UP', 'HITL_REQUIRED', 'CIBA'].includes(dec.decision) ? 'obligation' : 'deny',
    note: ctx.sit.forgedApproval ? 'the client sent a boolean "approved" flag; the BFF ignores it and needs a real, verified receipt' : undefined,
    detail: { decision: { outcome: dec.decision, by: 'authorize policy (mock)', reasons: [dec.reason].filter(Boolean) } },
  });
  if (dec.decision === 'DENY' || dec.decision === 'DENY_403') halt(ctx, dec.decision, 'authorize', 403, dec.reason);
  else if (dec.decision !== 'PERMIT') { ctx.pending = dec.decision; ctx.obligation = dec.decision; stepUp(ctx, dec.decision); }
}

// AI-DEMO2's step-up step, drawn right after the decision that asked for it. The lab simulates the approval: nothing reaches a person or a device.
const STEP_UP_HOW = { STEP_UP: 'a second factor (MFA)', HITL_REQUIRED: 'a person in the loop', CIBA: 'approval on another device (CIBA)' };
function stepUp(ctx, obligation) {
  hop(ctx, 'step-up', {
    from: 'authorize', to: 'hitl', url: `${ctx.urls.bff}/api/step-up`, body: { obligation, action: ctx.tool },
    status: obligation === 'STEP_UP' ? 428 : 202, verdict: obligation === 'HITL_REQUIRED' ? 'held' : 'obligation',
    resBody: { obligation, needs: STEP_UP_HOW[obligation], approved: false, note: 'the lab simulates the approval: nothing is sent to a person or a device' },
    note: obligation === 'CIBA' ? 'the CIBA hops that follow collect the approval' : 'the call waits here until the customer approves',
  });
}

function held(ctx) {
  if (ctx.heldShown) return;
  ctx.heldShown = true;
  hop(ctx, 'tool-held', { from: 'gateway', to: 'mcp', url: `${ctx.urls.mcp}/mcp`, status: 202, verdict: 'held', resBody: { dispatched: false, waiting_for: ctx.pending, note: 'the write is held until the obligation is satisfied' } });
}

// AI-DEMO2's order: Authorize decides first (a chain whose evidence has no authorize step still gets the decision when the use case needs authz),
// then the tools/call challenge, the gateway, the MCP server and the resource server behind it.
function dispatch(ctx) {
  if (ctx.halted) return refusal(ctx);
  if (!ctx.sit.public && ctx.uc.needs.includes('authz')) authorize(ctx);
  if (ctx.halted) return refusal(ctx);
  if (ctx.pending && ctx.pending !== 'CIBA') return held(ctx);
  gatewayLeg(ctx);
  if (ctx.halted) return refusal(ctx);
  toolCall(ctx);
}

// The tool runs and its back end answers. Bearer path: tool-dispatched then api-call with the delegated token. API-key path (AI-DEMO2 order:
// gateway, vault-key-inject, api-key-swap, mcp, api): the gateway fetches the route's key and swaps the bearer for it; the api step carries the key.
function toolCall(ctx) {
  const publicCall = ctx.sit.public;
  if (API_KEY_PATH.has(ctx.uc.id) && !publicCall) apiKeyPath(ctx);
  const bearer = publicCall ? {} : { authorization: `Bearer ${(ctx.exchanged || ctx.user).raw}` };
  const text = `mock result of ${ctx.tool} for ${ctx.cast.castAsset} data (synthetic)`;
  hop(ctx, 'tool-dispatched', {
    from: 'gateway', to: 'mcp', url: `${ctx.urls.mcp}/mcp`, headers: bearer,
    body: { jsonrpc: '2.0', method: 'tools/call', params: { name: ctx.tool, ...(ctx.sit.args ? { arguments: ctx.sit.args } : {}) } },
    resBody: { result: { tool: ctx.tool, isError: false, content: [{ type: 'text', text }] } },
    note: publicCall ? 'public catalog call: no token, no authorize, no gateway check' : undefined,
  });
  ctx.toolResult = text;
  const keyPath = API_KEY_PATH.has(ctx.uc.id) && !publicCall;
  const write = ctx.role === 'write' || Boolean(ctx.sit.args);
  hop(ctx, 'api-call', {
    from: 'mcp', to: 'api', method: write ? 'POST' : 'GET', url: `${ctx.urls.api}/v1/${String(ctx.tool).replace(/_/g, '-')}`,
    headers: keyPath ? { 'x-api-key': '[write-only]', 'x-user-sub': ctx.person.sub } : bearer,
    ...(write && ctx.sit.args ? { body: ctx.sit.args } : {}),
    resBody: { tool: ctx.tool, data: `${ctx.cast.castAsset} data (synthetic)`, source: 'mock' },
    note: publicCall ? 'public data: the resource server needs no token' : keyPath ? 'API-key path: the service key (write-only) and the user subject reach the resource server; no bearer' : 'the MCP server calls the resource server with the delegated token; the API checks it again',
  });
}

function apiKeyPath(ctx) {
  const route = `/v1/${String(ctx.tool).replace(/_/g, '-')}`;
  hop(ctx, 'vault-key-inject', {
    from: 'gateway', to: 'credentials', method: 'GET', url: `https://vault.${ctx.cast.castHost}.example/routes${route}/key`,
    resBody: { route, api_key: '[write-only]', note: 'the key stays on the server; it is never shown or logged' },
    detail: { kv: [['vault bridge', 'mock vault (lab)'], ['service key', '[write-only]']] },
  });
  hop(ctx, 'api-key-swap', {
    from: 'gateway', to: 'api', method: 'GET', url: `${ctx.urls.api}${route}`, headers: { 'x-api-key': '[write-only]', 'x-user-sub': ctx.person.sub },
    resBody: { tool: ctx.tool, data: `${ctx.cast.castAsset} data (synthetic)`, source: 'mock' },
    note: 'the OAuth bearer is stripped here; the service key and the user subject go to the back end',
    detail: { kv: [['swap', 'OAuth bearer -> service API key'], ['outbound', 'backend call with X-API-Key'], ['Authorization', 'stripped']] },
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

// ---- AI-DEMO2's frame around the chain (buildTraceSteps order) -------------------------------------------------------------------------------
const promptOf = (uc) => (uc.trigger?.type === 'chip' && uc.trigger.text ? uc.trigger.text : uc.title);
const sessionCookie = (ctx) => `cal_session=mock-${sha(`${ctx.trace.traceId}:session`, 12)}`;

function frameBefore(ctx) {
  hop(ctx, 'website', {
    from: 'browser', to: 'bff', method: 'GET', url: `${ctx.urls.bff}/`, headers: { cookie: sessionCookie(ctx) },
    resBody: { page: 'agent chat', note: 'the page holds no token; the HttpOnly session cookie identifies the browser to the BFF' },
  });
}

// What the visitor typed (`said`) appears on the prompt hop only; every other hop refers to it. The brain is the one the browser actually used.
const routingOf = (ctx) => (ctx.brain === 'llama' ? `llama.cpp picked ${ctx.uc.id} (local model, mock run)` : 'Scripted intent match');
function frameAfterSignIn(ctx) {
  const pub = ctx.sit.public;
  const chip = promptOf(ctx.uc);
  hop(ctx, 'prompt', {
    from: 'browser', to: 'bff', url: `${ctx.urls.bff}/api/agent/run`, headers: { 'content-type': 'application/json', cookie: sessionCookie(ctx) }, body: { message: ctx.said ?? chip },
    resBody: { accepted: true }, note: 'only the message and the session cookie; no Authorization header leaves the browser',
  });
  hop(ctx, 'agent-receive', {
    from: 'bff', to: 'agent', url: `${ctx.urls.agent}/run`, body: { message: '[the message on the prompt hop]' },
    resBody: { routing: routingOf(ctx), matched: ctx.uc.id },
    detail: { kv: [['routing', routingOf(ctx)], ['matched use case', ctx.uc.id]] },
  });
  // Only a run whose agent plans a tool call lists its tools and plans (AI-DEMO2's 'tools-list' and 'llm' steps); the rest go straight to the chain.
  if (!PLANS.has(ctx.uc.id)) return;
  const content = ctx.said !== undefined ? '[the message on the prompt hop]' : chip;
  if (!pub) challenge(ctx, 'tools-list-challenge', 'tools/list');
  hop(ctx, 'tools-list', {
    from: 'agent', to: 'gateway', url: `${ctx.urls.gw}/mcp`, headers: pub ? {} : { authorization: `Bearer ${ctx.user.raw}` },
    body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    resBody: { jsonrpc: '2.0', id: 2, result: { tools: [{ name: ctx.tool, inputSchema: { type: 'object' } }] } },
    note: pub ? 'public catalog: tools/list needs no token' : 'the BFF attaches the user token of the session it holds; the catalog is filtered to what this caller may use',
    detail: { kv: [['MCP session', 'initialize -> 2025-11-25 -> notifications/initialized'], ['tools permitted', ctx.tool]] },
  });
  hop(ctx, 'llm-plan', {
    from: 'agent', to: 'llm', url: `${ctx.urls.llm}/v1/chat/completions`,
    body: { model: ctx.brain === 'llama' ? 'llama.cpp (local model; the run itself is mock)' : 'scripted-intent-match (mock)', messages: [{ role: 'user', content }], tools: [ctx.tool] },
    resBody: { tool_calls: [{ name: ctx.tool, arguments: ctx.sit.args || {} }] },
    note: `${routingOf(ctx)}. The model proposes, policy decides; it never sees a token`,
    detail: { kv: [['brain', routingOf(ctx)]] },
  });
}

function reply(ctx) {
  // From the tool result, else from the run's own narration and outcome: never a claim that something ran when nothing did.
  const text = ctx.toolResult ? `Here is what I found: ${ctx.toolResult}.` : `No tool was called. ${narrate(ctx, finalOutcome(ctx))}`;
  hop(ctx, 'agent-reply', { from: 'agent', to: 'browser', url: `${ctx.urls.bff}/api/agent/run`, resBody: { reply: text } });
}

// AI-DEMO2's not-in-path steps (its SKIP_REASONS): listed after every hop that ran, verdict skip, no request and no trace span (they never ran).
function skipped(ctx) {
  // Each note is true for THIS run: it is chosen from the hops that ran.
  const ran = new Set(ctx.hops.map((h) => h.kind));
  const decided = ran.has('authorize-decision');
  const pushed = ctx.hops.some((h) => JSON.stringify(h.request?.body ?? '').includes('authorization_details'));
  const tool = ran.has('tool-dispatched');
  const stepNote = decided ? 'No step-up: the policy decision asked for no extra approval.'
    : ctx.halted ? 'No step-up: the run was refused before any policy decision ran.' : 'No step-up: no policy decision ran on this path.';
  const list = [
    ['step-up', 'authorize', 'hitl', !ran.has('step-up'), stepNote],
    ['intent-binding-verified', 'bff', 'authorize', !ran.has('intent-binding-verified'), pushed ? 'No separate intent-binding check ran in this path.' : 'No intent binding: no authorization_details were pushed for this call.'],
    ['vault-key-inject', 'gateway', 'credentials', !ran.has('vault-key-inject'), tool ? 'No vault key: this call used the OAuth bearer path.' : 'No vault key: no tool call reached the gateway route on this run.'],
    ['api-key-swap', 'gateway', 'api', !ran.has('api-key-swap'), tool ? 'No API-key swap: the delegated bearer is what reached the resource server.' : 'No API-key swap: no tool call reached the back end on this run.'],
    ['database-query', 'api', 'database', true, tool ? 'No database hop: the tool result names no SQL data source.' : 'No database hop: no tool ran on this run.'],
  ];
  for (const [kind, from, to, take, note] of list) {
    if (!take) continue;
    ctx.hops.push({ n: ctx.hops.length + 1, kind, label: label(ctx, kind), from, to, mock: true, verdict: 'skip', note, request: {}, response: {} });
  }
}

const STEPS = {
  'user-token': (ctx) => { if (!ctx.user) signIn(ctx); },
  'token-exchange': (ctx) => { needConsent(ctx); exchangeOnce(ctx); },
  'authorize-decision': authorize,
  'tool-dispatched': dispatch,
  'a2a-agent1-actor': (ctx) => { ctx.agent = { id: ctx.cast.castAgent, label: ctx.cast.castAgent }; actorToken(ctx, ctx.cast.castAgent, 'first agent'); },
  'a2a-exchange1': (ctx) => { needConsent(ctx); a2aExchange(ctx, 1); },
  'a2a-agent2-actor': (ctx) => { actorToken(ctx, ctx.cast.castAgent2, 'specialist'); },
  // AI-DEMO2 draws the A2A handoff (agent card, protocol message) after the second exchange. The lab's authorize / gateway / tool leg that follows
  // in these chains is kept: AI-DEMO2's reel path marks the specialist's own tool call as inferred.
  'a2a-exchange2': (ctx) => { a2aExchange(ctx, 2); if (A2A_PROTOCOL.has(ctx.uc.id) && !chainOf(ctx.uc).includes('a2a-agent-card')) { STEPS['a2a-agent-card'](ctx); STEPS['a2a-protocol-message'](ctx); } },
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
  'sim-replay-start': (ctx) => { exchangeOnce(ctx); if (gatewayCheck(ctx)) toolCall(ctx); }, // the first use is accepted and reaches the tool; the replay is refused
  'sim-rar-armed': (ctx) => hop(ctx, 'sim-rar-armed', { from: 'bff', to: 'idp', url: `${ctx.urls.idp}/par`, body: { response_type: 'code', authorization_details: [{ type: 'payment', maxAmount: ctx.sit.rar.maxAmount }] }, resBody: { request_uri: `urn:mock:par:${sha(ctx.trace.traceId, 10)}`, expires_in: 60 } }),
  'sim-rar-grant': (ctx) => { exchangeOnce(ctx); },
  'intent-binding-verified': (ctx) => { const dec = decide({ role: null, amount: ctx.amount, rar: ctx.sit.rar, actor: { registered: true } }); hop(ctx, 'intent-binding-verified', { from: 'gateway', to: 'authorize', url: 'https://authorize.mock.example/decision', body: { amount: ctx.amount, authorization_details: [{ type: 'payment', maxAmount: ctx.sit.rar.maxAmount }] }, resBody: { decision: dec.decision, reason: dec.reason }, verdict: dec.decision === 'PERMIT' ? 'ok' : 'deny' }); if (dec.decision !== 'PERMIT') halt(ctx, dec.decision, 'authorize', 403, dec.reason); },
  'exchange-skipped': (ctx) => { hop(ctx, 'exchange-skipped', { from: 'bff', to: 'gateway', url: `${ctx.urls.bff}/api/tool`, status: 403, verdict: 'deny', headers: {}, resBody: { error: 'user_token_forwarding_disabled', note: 'the BFF refuses to hand the raw user token to a tool; it must exchange first (fail closed)' } }); halt(ctx, 'DENY_403', 'bff', 403, 'user_token_forwarding_disabled'); },
  'gateway-permit': (ctx) => { if (!ctx.halted) { ctx.exchanged = ctx.exchanged || ctx.user; gatewayCheck(ctx, { key: 'gateway-check' }); } },
  'privilege-gateway-leg': (ctx) => hop(ctx, 'privilege-gateway-leg', { from: 'bff', to: 'privilege', url: 'https://privilege.mock.example/gateway', headers: { authorization: `Bearer ${(ctx.exchanged || ctx.user).raw}` }, resBody: { accepted: true } }),
  'credential-swap': (ctx) => { const t = mint(ctx, 'operator credential (MOCK)', { sub: 'operator-service-mock', aud: ctx.urls.mcp, scope: ctx.scope }, 'at+jwt'); hop(ctx, 'credential-swap', { from: 'privilege', to: 'mcp', url: `${ctx.urls.mcp}/mcp`, headers: { authorization: `Bearer ${t.raw}` }, resBody: { swapped: true, note: 'the caller bearer is swapped for the operator credential before the call leaves' } }); },
  'enterprise-managed-mode': (ctx) => hop(ctx, 'enterprise-managed-mode', { from: 'bff', to: 'idp', url: `${ctx.urls.idp}/group-policy`, body: { sub: ctx.person.sub, group: ctx.cast.castGroup }, resBody: { allowed: true, note: 'group policy decides issuance; no per-server consent screen' } }),
  'id-jag-issued': (ctx) => { if (!ctx.agents.length) actorToken(ctx, ctx.agent.id, 'agent'); /* AI-DEMO2: the agent token comes before the ID-JAG */ const t = mint(ctx, 'ID-JAG (MOCK)', { sub: ctx.person.sub, aud: ctx.urls.mcp, scope: ctx.scope, jti: sha(`${ctx.trace.traceId}:idjag`, 16) }, 'oauth-id-jag+jwt'); ctx.idjag = t; hop(ctx, 'id-jag-issued', { from: 'bff', to: 'idp', url: `${ctx.urls.idp}/token`, body: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag', subject_token: ctx.user.raw }, resBody: { access_token: t.raw, issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag' } }); },
  'id-jag-redeemed': (ctx) => { const t = mint(ctx, 'MCP access token (MOCK)', { sub: ctx.person.sub, aud: ctx.urls.mcp, scope: ctx.scope }, 'at+jwt'); ctx.exchanged = t; ctx.exchangedVia = 'id-jag'; ctx.exchangedClaims = t.claims; hop(ctx, 'id-jag-redeemed', { from: 'bff', to: 'mcp-as', url: `${ctx.urls.mcp}/token`, body: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: ctx.idjag.raw }, resBody: { access_token: t.raw, token_type: 'Bearer', note: 'single-use assertion; scoped to this one server' } }); },
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
  frameBefore(ctx);
  if (!ctx.sit.public) signIn(ctx);
  frameAfterSignIn(ctx);
  for (const step of chainOf(uc)) {
    if (!Object.hasOwn(STEPS, step)) throw new Error('unknown evidence step');
    if (step === 'user-token' && ctx.user) continue;
    STEPS[step](ctx);
  }
  // Gateway-only events (rate limit, validation outage) on a chain that never reaches a dispatch step still meet the gateway.
  if (!ctx.halted && !ctx.gwDone && ctx.event && ctx.uc.needs.includes('gw')) gatewayCheck(ctx);
  // A chain with no dispatch step whose use case reaches the MCP server in AI-DEMO2 runs the dispatch leg now (Authorize when needed, the
  // tools/call challenge, the gateway, the tool and its back end). Nothing else meets the gateway after the chain: a forwarded call always has a tool.
  if (!ctx.halted && !ctx.pending && CALLS_TOOL.has(uc.id) && !ctx.hops.some((h) => h.kind === 'tool-dispatched')) dispatch(ctx);
  if (ctx.halted) refusal(ctx);
  else if (ctx.pending && ctx.pending !== 'CIBA') held(ctx);
  else if (!ctx.pending) reply(ctx); // AI-DEMO2 cuts at the first error and a held run stops at the hold: only a finished run replies
  skipped(ctx);
  const outcome = finalOutcome(ctx);
  return { ...base, kind: 'flow', computed: true, persona: ctx.person.key, outcome, matchesExpected: outcome === uc.expectedOutcome, hops: enrichAll(ctx), tokens: ctx.tokens, traceId: ctx.trace.traceId, traceparent: formatTraceparent(ctx.trace.traceId, ctx.rootSpan), narration: narrate(ctx, outcome) };
}
