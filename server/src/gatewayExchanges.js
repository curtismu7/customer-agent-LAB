// "What Privilege did" (Rule 25): turns what this lab already has into the records the shared GatewayTrace panel draws.
// The shared builder is server/src/gatewayTrace.js (vendored, never edited); this file is the lab's own part.
//
// Mock: the lab's own simulated gateway (flow.js gatewayCheck) computed its checks, so those decisions are `checked`. A hop into the gateway is a
//   request and an answer the engine built, shown exactly. tools/list has no check in the engine, so its one decision is read from the answer (`observed`).
// Real: the Agent Gateway answers with a status and a body, not a per-check breakdown, so every decision is `inferred` or `observed`, never `checked`.
//   The request is the exact JSON-RPC message the lab sent (mcpClient.send keeps it); the bearer is shown as its length only.
import { bearerForDisplay, mockTrace, realTrace, failureTrace } from './gatewayTrace.js';
import { parseAuditTrail, shortId } from './mcpClient.js';

// The hops that are a request INTO the gateway (flow.js: challenge(), the tools/list hop, gatewayCheck()). The gateway's own calls onward (to the MCP
// server, the vault, the API) are not calls to the gateway and are not traced here.
const INTO_GATEWAY = new Set(['tools-list-challenge', 'tools-call-challenge', 'tools-list', 'gateway-check']);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'check';

function mockDecisions(hop) {
  const body = hop.response?.body;
  if (Array.isArray(hop.stages) && hop.stages.length) {
    return hop.stages.map((s, i) => ({
      id: `${slug(s.name)}-${i}`, label: s.name,
      outcome: s.result === 'pass' ? 'pass' : s.result === 'fail' ? 'fail' : 'skipped',
      evidence: s.note || (s.result === 'pass' ? 'passed' : ''),
    }));
  }
  if (hop.response?.status === 401) {
    return [{ id: 'bearer-token', label: 'Bearer token', outcome: 'fail', evidence: 'the request carries no Authorization header, so the gateway answers 401 and names where its resource metadata is' }];
  }
  const tools = Array.isArray(body?.result?.tools) ? body.result.tools.map((t) => t?.name).filter(Boolean) : [];
  return [{ id: 'tools', label: 'Tools listed', outcome: 'pass', basis: 'observed', evidence: tools.length ? `the answer lists ${tools.length} tool${tools.length === 1 ? '' : 's'}: ${tools.join(', ')}` : 'the answer lists no tools' }];
}

// hops: the enriched hops of a Mock run (run.hops). Returns [{ step, title, status, trace }] for the panel.
export function mockExchanges(hops) {
  const out = [];
  for (const hop of hops || []) {
    if (!INTO_GATEWAY.has(hop.kind) || hop.verdict === 'skip' || hop.source === 'not-run' || !hop.request?.url) continue;
    const h = hop.request.headers || {};
    const trace = mockTrace({
      url: hop.request.url, authorization: h.authorization, rpc: hop.request.body ?? null,
      status: hop.response.status, headers: hop.response.headers || {}, body: hop.response.body ?? null,
      // Exactly the headers the engine put on this hop: no default the hop did not carry (no accept, no authorization on a challenge).
      requestHeaders: { ...h, authorization: h.authorization ?? null, 'content-type': h['content-type'] ?? null, accept: null },
      decisions: mockDecisions(hop),
    });
    out.push({ step: out.length + 1, title: hop.label, status: hop.response.status, trace });
  }
  return out;
}

// ---- Real -----------------------------------------------------------------------------------------------
const GRANT = {
  initialize: { label: 'MCP session', pass: 'the gateway opened an MCP session' },
};
const PLACEHOLDER = '[the delegated token]';

// calls: [{ title, call, setup? }] where call is a mcpClient send() result; token is the delegated token (never shown); url is the gateway URL.
export function realExchanges(calls, { url, token }) {
  const authorization = bearerForDisplay(PLACEHOLDER, () => token);
  const scrub = (v) => (v === null || v === undefined || !token ? v : JSON.parse(JSON.stringify(v).split(token).join(PLACEHOLDER)));
  const out = [];
  for (const { title, call: c, setup } of calls || []) {
    const rpc = scrub(c.sent?.message ?? null);
    const requestHeaders = c.sent?.headers || {};
    let trace;
    if (c.status === 0) {
      trace = failureTrace({ url, authorization, rpc, requestHeaders, error: 'no answer from the gateway (the connection failed or timed out)' });
    } else {
      const audit = parseAuditTrail(c.headers?.['x-gw-audit-trail']);
      trace = realTrace({
        url, authorization, rpc, requestHeaders, status: c.status, headers: scrub(Object.fromEntries(Object.entries(c.headers || {}).map(([k, v]) => [k, k === 'mcp-session-id' ? shortId(v) : v]))), body: scrub(c.rpc ?? null),
        grant: rpc?.method === 'initialize' ? GRANT.initialize : undefined,
        detail: c.status === 428 ? 'the gateway answered 428: the call is held for a person (HITL or step-up); a hold is not a pass' : undefined,
        setup,
      });
      // The one decision the real gateway does state itself: the audit trail header. It is read from the response, so it is `observed`.
      if (audit?.decision) {
        const word = audit.decision.toUpperCase();
        trace.decisions.push({ id: 'audit-trail', label: 'Audit trail', outcome: word === 'PERMIT' ? 'pass' : word === 'DENY' ? 'fail' : 'info', basis: 'observed', evidence: `the X-Gw-Audit-Trail header says ${audit.decision}` });
      }
    }
    out.push({ step: out.length + 1, title, status: c.status || null, trace });
  }
  return out;
}
