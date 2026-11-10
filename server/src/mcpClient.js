// The MCP client for full Real (owner, 2026-11-10): JSON-RPC over Streamable HTTP to the ONE Agent Gateway URL the owner configured
// (CAL_AGENT_GATEWAY_URL). It sends exactly the headers listed in gatewayHeaders() and nothing else. The trusted-caller headers that AI-DEMO2's own
// services use between themselves (TRUSTED_HEADERS) are never sent: assertNoTrusted() refuses a request that carries one, and a test pins both.
// Answers are read with a size cap and a timeout, no redirect is followed, and an event-stream answer is parsed for the one JSON-RPC reply.
import { isLoopbackHost } from './safety.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const GATEWAY_TIMEOUT_MS = 10_000;
export const GATEWAY_MAX_BYTES = 256 * 1024;
// Never sent (lower-case). These let a trusted service assert things a caller must not assert about itself.
export const TRUSTED_HEADERS = ['x-internal-gateway-secret', 'x-authz-simulated', 'x-act-client-id', 'x-may-act-sub', 'x-demo-force-actor'];
// The only header names this client may send.
export const SENT_HEADERS = ['authorization', 'x-token-validation', 'mcp-session-id', 'mcp-protocol-version', 'traceparent', 'x-active-vertical', 'content-type', 'accept'];

export class GatewayRefused extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// The gateway URL the settings name: https (http only on a loopback host, for the tests' fake), no credentials, no query or fragment.
export function gatewayUrlProblem(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'CAL_AGENT_GATEWAY_URL is not a URL'; }
  if (u.username || u.password) return 'CAL_AGENT_GATEWAY_URL must not carry credentials';
  if (u.search || u.hash) return 'CAL_AGENT_GATEWAY_URL must not carry a query or a fragment';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname))) return 'CAL_AGENT_GATEWAY_URL must be https';
  return null;
}

export function assertNoTrusted(headers) {
  for (const k of Object.keys(headers)) {
    const name = k.toLowerCase();
    if (TRUSTED_HEADERS.includes(name)) throw new GatewayRefused('trusted_header', 'A trusted-caller header is never sent to the gateway');
    if (!SENT_HEADERS.includes(name)) throw new GatewayRefused('other_header', 'Only the listed headers are sent to the gateway');
  }
  return headers;
}

// The headers of one gateway call. vertical is a known vertical id (checked by the caller); sessionId and protocol come from the gateway's own answer.
export function gatewayHeaders({ token, traceparent, vertical, sessionId = null, protocol = null }) {
  const h = {
    authorization: `Bearer ${token}`,
    'x-token-validation': 'jwks',
    traceparent,
    'x-active-vertical': vertical,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) h['mcp-session-id'] = sessionId;
  if (protocol) h['mcp-protocol-version'] = protocol;
  return assertNoTrusted(h);
}

async function readCapped(response, max) {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > max) { chunks.push(value.subarray(0, max - total)); await reader.cancel().catch(() => {}); return { text: Buffer.concat(chunks).toString('utf8'), truncated: true }; }
    chunks.push(value); total += value.length;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
// One JSON-RPC reply from a JSON body or an event stream (the last `data:` event whose id matches).
export function parseRpc(text, contentType, id) {
  if (/text\/event-stream/i.test(String(contentType || ''))) {
    let found = null;
    for (const block of String(text).split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { const j = asObject(JSON.parse(data)); if (j && (id === undefined || j.id === id)) found = j; } catch { /* not JSON */ }
    }
    return found;
  }
  try { return asObject(JSON.parse(text)); } catch { return null; }
}

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : null);
// X-Gw-Audit-Trail: JSON, or base64url JSON, or plain text. Returns { raw, parsed, decision }.
export function parseAuditTrail(value) {
  if (typeof value !== 'string' || !value) return null;
  const raw = value.slice(0, 2000);
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {
    try { const d = Buffer.from(raw, 'base64url').toString('utf8'); if (/^[[{]/.test(d.trim())) parsed = JSON.parse(d); } catch { parsed = null; }
  }
  const pick = (o) => (asObject(o) ? str(o.decision) ?? str(o.outcome) ?? str(o.result) : null);
  let decision = null;
  if (Array.isArray(parsed)) for (const e of parsed) decision = pick(e) ?? decision;
  else decision = pick(parsed);
  return { raw, parsed, decision };
}

// The gateway's HTTP answer in the lab's words. 403 = a policy DENY, 401 = a token problem, 428 = a hold for a person, 502/503/504 or no answer = SE
// is down or scaled down. Never retried.
export function classify(status) {
  if (status === 0 || status === 502 || status === 503 || status === 504) return 'unreachable';
  if (status === 401) return 'token';
  if (status === 403) return 'deny';
  if (status === 428) return 'hold';
  if (status >= 200 && status < 300) return 'ok';
  return 'other';
}

// One gateway session: initialize, then the notification the protocol asks for, then tools/list and tools/call with the session id the gateway gave.
export function createGatewaySession({ url, token, vertical, nextTraceparent, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = GATEWAY_TIMEOUT_MS, maxBytes = GATEWAY_MAX_BYTES }) {
  const problem = gatewayUrlProblem(url);
  if (problem) throw new GatewayRefused('bad_url', problem);
  const target = new URL(url).toString();
  let sessionId = null; let protocol = null; let seq = 0;

  async function send(method, params, { notification = false } = {}) {
    const traceparent = nextTraceparent();
    const id = notification ? undefined : ++seq;
    const headers = gatewayHeaders({ token, traceparent, vertical, sessionId, protocol });
    const body = JSON.stringify(notification ? { jsonrpc: '2.0', method, ...(params ? { params } : {}) } : { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    let response; let read = { text: '', truncated: false };
    try {
      response = await fetchImpl(target, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      read = await readCapped(response, maxBytes);
    } catch { return { method, traceparent, status: 0, kind: 'unreachable', headers: {}, rpc: null, sentHeaders: Object.keys(headers) }; }
    const sid = response.headers.get('mcp-session-id');
    if (method === 'initialize' && sid && /^[\x21-\x7e]{1,200}$/.test(sid)) sessionId = sid;
    const shown = {};
    for (const k of ['content-type', 'www-authenticate', 'x-gw-audit-trail', 'mcp-session-id']) { const v = response.headers.get(k); if (v) shown[k] = v.slice(0, 2000); }
    const rpc = read.truncated ? null : parseRpc(read.text, response.headers.get('content-type'), id);
    if (method === 'initialize' && rpc?.result && typeof rpc.result.protocolVersion === 'string' && /^[0-9-]{4,20}$/.test(rpc.result.protocolVersion)) protocol = rpc.result.protocolVersion;
    // A redirect is never followed: it is shown as an answer of its own ("other").
    return { method, traceparent, status: response.status, kind: response.status >= 300 && response.status < 400 ? 'other' : classify(response.status), headers: shown, rpc, truncated: read.truncated, sentHeaders: Object.keys(headers) };
  }

  return {
    initialize: () => send('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'customer-agent-lab', version: '1' } }),
    initialized: () => send('notifications/initialized', null, { notification: true }),
    listTools: () => send('tools/list', {}),
    callTool: (name, args) => send('tools/call', { name, arguments: args }),
    sessionId: () => sessionId,
  };
}
