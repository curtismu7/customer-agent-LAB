// "What each layer logged for this run" (rule 27): the lab's half of the shared panel.
// The shared core is server/src/runObservability.js (vendored, never edited). This file maps what the lab computed or received into the six
// layers, and writes one stdout line per policy-point decision the lab records.
//
// Mock (a computed run): every row is `simulated`, stamped once with the time the mock computed the run. The mock has no per-hop clock.
// Real (a full Real run): every row is a `response` row (a reply the lab holds, never a log). Nothing is read from a log: this lab reads none.
// Only a policy point is allowed or refused (the gateway's check, the Authorize decision); a lab stop is blocked; everything else is info.
import { randomBytes } from 'node:crypto';
import { createRunObservability, RunObsError } from './runObservability.js';

const LAB = 'customer-agent-lab';

// Mock hop kind -> layer. A kind not listed here is not one of the six layers (the record does not show it).
const MOCK_LAYER = {
  'sign-in': 'person', 'user-token': 'person',
  'actor-token': 'agent', 'token-exchange': 'agent', 'id-jag-issued': 'agent', 'id-jag-redeemed': 'agent',
  'verified-trust-issuance': 'agent', 'enterprise-managed-mode': 'agent',
  'authorize-decision': 'authorize', 'intent-binding-verified': 'authorize',
  'privilege-gateway-leg': 'privilege', 'credential-swap': 'privilege',
  'gateway-check': 'gateway', 'exchange-skipped': 'gateway', 'tools-list-challenge': 'gateway', 'tools-call-challenge': 'gateway', 'tools-list': 'gateway',
  'api-call': 'resource', 'tool-dispatched': 'resource',
};

// The outcome a mock hop is allowed to carry: only the gateway check and the Authorize decision are policy points.
// The lab's own stop (the BFF refusing to forward the user token) is blocked. A 401 challenge, an issuance and a fault are info.
function mockOutcome(hop) {
  if (hop.kind === 'exchange-skipped') return 'blocked';
  if (hop.kind === 'gateway-check' || hop.kind === 'authorize-decision' || hop.kind === 'intent-binding-verified') {
    if (hop.verdict === 'ok') return 'allowed';
    if (hop.verdict === 'deny') return 'refused';
  }
  return 'info';
}

// The row's words are the lab's own, short and fixed per kind (the hop labels carry request detail the masker would cut).
const MOCK_TEXT = {
  'sign-in': 'Sign-in', 'user-token': 'User token', 'actor-token': 'Agent token (client credentials)', 'token-exchange': 'Token exchange (RFC 8693)',
  'id-jag-issued': 'ID-JAG issued', 'id-jag-redeemed': 'MCP access token redeemed from the ID-JAG', 'verified-trust-issuance': 'Agent assertion issued',
  'enterprise-managed-mode': 'Group policy check', 'authorize-decision': 'Authorize decision', 'intent-binding-verified': 'Intent binding checked by Authorize',
  'privilege-gateway-leg': 'Call handed to the Privilege gateway', 'credential-swap': 'Caller credential swapped for the operator credential',
  'gateway-check': 'Agent Gateway check', 'exchange-skipped': 'Lab stop: the BFF will not forward the user token',
  'tools-list-challenge': 'Agent Gateway challenge for tools/list', 'tools-call-challenge': 'Agent Gateway challenge for tools/call', 'tools-list': 'Agent Gateway tools/list',
  'api-call': 'API call behind the tool', 'tool-dispatched': 'Tool dispatched to the MCP server',
};

const mockRow = (hop) => ({
  layer: MOCK_LAYER[hop.kind],
  outcome: mockOutcome(hop),
  message: `${MOCK_TEXT[hop.kind] ?? hop.kind}${Number.isInteger(hop.response?.status) ? ` (HTTP ${hop.response.status})` : ''}`,
});

// Real: the gateway's decision is its answer to the tool call: a 403 is the policy DENY, a 200 is an allow. A fault (502, 503, 504, no connection),
// a 401 token check and a 428 hold are not decisions: they are information. The gateway-check (initialize and tools/list) is a listing: refused
// only when the gateway refused the listing outright with a 403.
const POLICY_DENY = 403;
const answeredDeny = (hop) => hop.verdict === 'deny' && [hop.response?.status, ...(hop.response?.calls || []).map((c) => c?.status)].includes(POLICY_DENY);
// A tool-refused hop is the lab's own stop only when no gateway answer refused it: the lab did not call the tool (every reply it made was a 2xx).
const labStop = (hop) => (hop.response?.calls || []).every((c) => c?.status >= 200 && c?.status < 300);
function realOutcome(hop) {
  if (hop.kind === 'tool-refused') return labStop(hop) ? 'blocked' : 'info';
  if (hop.kind === 'gateway-check') return answeredDeny(hop) ? 'refused' : 'info';
  return 'info';
}

const REAL_TEXT = {
  'sign-in': 'PingOne sign-in answered (pi.flow)', 'actor-token': 'PingOne answered the agent token request', 'token-exchange': 'PingOne answered a token exchange',
  'authorize-decision': 'Authorize decision, read from the gateway answer', 'gateway-check': 'Agent Gateway answered the MCP session and tools/list',
  'tool-refused': 'Lab stop: the lab did not call the tool', 'api-call': 'The SE MCP server answered the tool call',
};
// The words of a row: a listing that got no usable reply is not described as an answer to the listing (the lab may have been on any of its calls).
function realText(hop) {
  if (hop.kind === 'gateway-check' && hop.verdict !== 'ok') return 'Agent Gateway reply while the lab was opening or making the MCP session or tools/list call (not a listing)';
  if (hop.kind === 'tool-refused' && !labStop(hop)) return 'Agent Gateway answer to the tools/call request: the tool did not run';
  return REAL_TEXT[hop.kind] ?? hop.kind;
}

const REAL_LAYER = {
  'sign-in': 'person', 'actor-token': 'agent', 'token-exchange': 'agent',
  'authorize-decision': 'authorize', 'gateway-check': 'gateway', 'tool-refused': 'resource', 'api-call': 'resource',
};

// Mock: one simulated row per hop of the layers above, plus the persona the mock computed (its person).
export function mockLayers(run, at) {
  const rows = new Map();
  const add = (layer, row) => { if (!rows.has(layer)) rows.set(layer, []); rows.get(layer).push(row); };
  if (run.persona) add('person', { at, outcome: 'info', message: `Mock persona: ${run.persona} (the mock signs in offline; no PingOne sign-in is made)` });
  for (const hop of run.hops || []) {
    if (hop.verdict === 'skip' || hop.source === 'not-run' || !MOCK_LAYER[hop.kind]) continue;
    add(MOCK_LAYER[hop.kind], { at, ...mockRow(hop) });
  }
  const reason = { person: 'No persona was chosen for this run.', agent: 'The mock has no agent-token hop for this use case.', authorize: 'The mock has no Authorize decision for this use case.', privilege: 'The mock has no Privilege hop for this use case.', gateway: 'The mock has no Agent Gateway check for this use case.', resource: 'The mock has no MCP server or API hop for this use case.' };
  return ['person', 'agent', 'authorize', 'privilege', 'gateway', 'resource'].map((layer) => ({
    layer, products: [], reason: reason[layer], simulated: rows.get(layer) || [],
  }));
}

// Real: the answers the lab received. Each row is stamped with the time the lab received its reply (hop.receivedAt, set by real.js when the reply
// comes in); a hop with no receive time gets no row, because a row must not be stamped with a time the lab did not have the reply. `run.gatewayTrace`
// is the gateway trace; its audit-trail decision is the Privilege row (the same reply as the gateway).
export function realLayers(run) {
  const rows = new Map();
  const add = (layer, row) => { if (!rows.has(layer)) rows.set(layer, []); rows.get(layer).push(row); };
  for (const hop of run.hops || []) {
    if (hop.verdict === 'skip' || hop.source === 'not-run' || !REAL_LAYER[hop.kind]) continue;
    if (!Number.isFinite(hop.receivedAt)) continue;
    const at = hop.receivedAt;
    if (hop.kind === 'authorize-decision') {
      // One reply, two readings: the Authorize row is information; the gateway's decision for the tool call is the policy point.
      add('authorize', { at, outcome: 'info', message: REAL_TEXT[hop.kind] });
      const outcome = hop.verdict === 'ok' ? 'allowed' : answeredDeny(hop) ? 'refused' : 'info';
      const message = outcome === 'info' ? 'Agent Gateway reply to the tools/call request: not an allow and not a 403, so not a policy decision' : 'Agent Gateway answer to the tool call';
      add('gateway', { at, outcome, message });
      continue;
    }
    add(REAL_LAYER[hop.kind], { at, outcome: realOutcome(hop), message: realText(hop) });
  }
  const audit = (run.gatewayTrace || []).flatMap((e) => (e.trace?.decisions || []).filter((d) => d.id === 'audit-trail'));
  // The audit trail is in the gateway's answer to the tool call: its time is that reply's time (the Authorize hop's receive time).
  const answeredAt = (run.hops || []).find((h) => h.kind === 'authorize-decision' && Number.isFinite(h.receivedAt))?.receivedAt;
  const privilege = audit.length && Number.isFinite(answeredAt)
    ? audit.map((d) => ({ at: answeredAt, outcome: 'info', message: `The Agent Gateway's X-Gw-Audit-Trail header: ${d.evidence} (the same reply as the gateway row)` }))
    : [];
  const reason = {
    person: 'PingOne sign-in is not logged: this lab shows the sign-in answer it received.',
    agent: 'No agent token or exchange answer was received.',
    authorize: 'The gateway answered without an Authorize decision.',
    privilege: 'The gateway answer carried no X-Gw-Audit-Trail header, so no Privilege decision is shown.',
    gateway: 'The Agent Gateway was not reached in this run.',
    resource: 'No MCP server answer was received.',
  };
  return ['person', 'agent', 'authorize', 'privilege', 'gateway', 'resource'].map((layer) => ({
    layer, products: [], reason: reason[layer], responses: layer === 'privilege' ? privilege : rows.get(layer) || [],
  }));
}

// The sanitiser for every value on a stdout line: only these characters survive, so a value cannot add a key=value or a second line.
const SAFE = /[^A-Za-z0-9._:/@-]/g;
export const clean = (v, n = 64) => String(v ?? '').replace(SAFE, '').slice(0, n) || 'none';

// One line per policy-point decision the lab recorded, from the record's own rows (the line time IS the row time).
// The writer is injected; a throwing writer costs its own line and nothing else (rule 6).
export function decisionLines(record, { runId, write, error = () => {} }) {
  let lines = 0;
  for (const r of record.rows) {
    if (r.outcome !== 'allowed' && r.outcome !== 'refused' && r.outcome !== 'blocked') continue;
    const result = r.outcome === 'allowed' ? 'passed' : 'stopped';
    const line = `${r.atExact} ${LAB} decision step=${clean(r.layer)} actor=${clean(r.origin)} result=${result} run=${clean(runId, 80)}`;
    try { write(line); lines += 1; } catch (e) { error(e?.name || 'error'); }
  }
  return lines;
}

export function newRunId() {
  return `run-${randomBytes(6).toString('hex')}`;
}

// Builds the record for one run. Returns null when the run has no decisions the panel can show (a guided run, a Mock run that stays Mock in
// Real, the identity-provider-only Live run): the panel is then not drawn, and the run says why in its own answer.
// Never throws: a failure here costs the panel, not the run. `error` gets the code and name only (never the message).
export async function buildRunRecord({ run, mode, runId, startedAt, endedAt, write = () => {}, error = () => {} }) {
  const wanted = (mode === 'mock' && run.kind === 'flow') || (mode === 'real' && run.kind === 'real');
  if (!wanted) return null;
  try {
    const layers = mode === 'mock' ? mockLayers(run, startedAt) : realLayers(run);
    const record = await createRunObservability({ readers: [] }).collectRun({ runId, startedAt, endedAt, layers, source: mode, correlation: {} });
    decisionLines(record, { runId, write, error });
    return record;
  } catch (e) {
    error(e instanceof RunObsError ? e.code : e?.name || 'error');
    return null;
  }
}
