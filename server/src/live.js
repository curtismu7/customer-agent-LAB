// Live mode (step 3). The one path out of this app. A live run makes exactly two real calls, both to the ONE PingOne environment the owner configured in the
// shared settings file: the public discovery document (GET) and a client-credentials token for the agent's own client (POST). Nothing else is reachable:
// every call is built here from fixed paths under /<environment id>/as/, goes out over https (loopback http only for the tests' fake), without following
// redirects, with a timeout and a body cap, and is checked again by assertAllowed() before a socket opens. The netguard (netguard.js) allows this one host
// and refuses every other, so even a bug here cannot reach another origin.
//
// What a live run is NOT: it does not sign a customer in (the lab holds no user credential and the sign-in is pi.flow only), it does not run the token
// exchange, the gateway check, the authorize decision or the tool call (other origins this lab may not call), and it does not recompute the use case's
// outcome. Those steps are listed as "not run". The mock engine is not mixed in: a live run is real hops only, so nothing mock is passed off as live.
//
// The worker client secret is read once, held in a closure, sent only in the Authorization header of the token call, and never returned, logged or
// stored. The token that comes back is shown masked (first 6 and last 4 characters) beside its decoded header and claims (live tokens are never raw).
import { chainOf } from './flow.js';
import { isLoopbackHost } from './safety.js';
import { formatTraceparent, newTrace } from './trace.js';
import { enrichHop } from './vendor/hopDetail.mjs';
import HOP_CATALOG from './vendor/hop-catalog.json' with { type: 'json' };

export const TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_IN_FLIGHT = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// PingOne regions (auth.pingone.<tld>). An unknown region is "not configured", never a guess.
const REGION_TLD = { na: 'com', us: 'com', com: 'com', eu: 'eu', ca: 'ca', ap: 'asia', asia: 'asia' };
const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';

export class LiveRefused extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// settings: { PINGONE_ENVIRONMENT_ID, PINGONE_REGION, PINGONE_CLIENT_ID, PINGONE_CLIENT_SECRET } from the shared file. Returns the live config, or { problem }
// naming (in fixed words, never a value) what is missing. testBase (CAL_LIVE_TEST_BASE) is for the tests' fake PingOne and must be http on a loopback host.
export function liveConfig(settings = {}, env = process.env) {
  const environmentId = String(settings.PINGONE_ENVIRONMENT_ID || '');
  const clientId = String(settings.PINGONE_CLIENT_ID || '');
  const clientSecret = String(settings.PINGONE_CLIENT_SECRET || '');
  if (!UUID.test(environmentId)) return { problem: 'the shared settings file has no valid PINGONE_ENVIRONMENT_ID' };
  if (!clientId || clientId.length > 200 || /[\u0000-\u001f\u007f]/.test(clientId)) return { problem: 'the shared settings file has no valid PINGONE_CLIENT_ID' };
  if (!clientSecret || clientSecret.length > 512 || /[\u0000-\u001f\u007f]/.test(clientSecret)) return { problem: 'the shared settings file has no valid PINGONE_CLIENT_SECRET' };
  let base;
  if (env.CAL_LIVE_TEST_BASE) {
    try {
      const u = new URL(env.CAL_LIVE_TEST_BASE);
      if (u.protocol !== 'http:' || !isLoopbackHost(u.hostname) || u.username || u.password || u.pathname.replace(/\/+$/, '') !== `/${environmentId}`) throw new Error('bad');
      base = `${u.origin}/${environmentId}`;
    } catch { return { problem: 'CAL_LIVE_TEST_BASE must be http on a loopback host with the environment id as its path' }; }
  } else {
    const tld = REGION_TLD[String(settings.PINGONE_REGION || 'com').toLowerCase()];
    if (!tld) return { problem: 'the shared settings file has no valid PINGONE_REGION (com, eu, ca or asia)' };
    base = `https://auth.pingone.${tld}/${environmentId}`;
  }
  return { environmentId, clientId, clientSecret, base };
}

const endpoints = (base) => ({ discovery: `${base}/as/.well-known/openid-configuration`, token: `${base}/as/token` });

// The last check before a socket opens: https (http only on loopback), no credentials in the URL, the configured origin, and one of the two fixed paths.
export function assertAllowed(target, base) {
  let url; let allowed;
  try { url = new URL(target); allowed = new URL(base); } catch { throw new LiveRefused('bad_url', 'Not a URL'); }
  if (url.username || url.password) throw new LiveRefused('credentials_in_url', 'Outbound URLs must not carry credentials');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) throw new LiveRefused('not_https', 'Outbound calls are https only');
  if (url.origin !== allowed.origin) throw new LiveRefused('other_origin', 'Outbound calls may only reach the configured PingOne environment');
  const ok = Object.values(endpoints(base)).some((e) => new URL(e).pathname === url.pathname) && !url.search && !url.hash;
  if (!ok) throw new LiveRefused('other_path', 'Outbound calls may only reach the discovery document and the token endpoint');
  return url;
}

const b64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
function decodeJwt(raw) {
  const parts = String(raw).split('.');
  if (parts.length !== 3) return null;
  try { return { header: JSON.parse(b64(parts[0])), claims: JSON.parse(b64(parts[1])) }; } catch { return null; }
}
const mask = (raw) => (raw.length >= 24 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : '[masked]');

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

export const NOT_RUN_REASON = 'Live mode in this lab reaches the identity provider only. These steps need a real customer sign-in (pi.flow, which this lab does not drive), the gateway, the policy engine or the tool server: other origins the lab may not call. They are not run and not simulated here; switch to Mock to see them.';

// config: from liveConfig() (or { problem }). fetchImpl defaults to the global fetch at call time, so the netguard's guarded fetch is the one used.
export function createLive({ config = liveConfig({}, {}), fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = TIMEOUT_MS, maxBytes = MAX_BODY_BYTES } = {}) {
  let inFlight = 0;
  const configured = () => !config.problem;
  const urls = configured() ? endpoints(config.base) : null;

  async function call(which, traceparent) {
    const url = assertAllowed(urls[which], config.base);
    const init = which === 'token'
      ? { method: 'POST', headers: { traceparent, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}` }, body: 'grant_type=client_credentials' }
      : { method: 'GET', headers: { traceparent, accept: 'application/json' } };
    let response; let body = { text: '', truncated: false };
    try {
      response = await fetchImpl(url.toString(), { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      body = await readCapped(response, maxBytes);
    } catch { return { status: 0, unreachable: true, json: null, text: '' }; }
    let json = null;
    if (!body.truncated && body.text) { try { const j = JSON.parse(body.text); json = j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { json = null; } }
    return { status: response.status, redirected: response.status >= 300 && response.status < 400, json, text: body.truncated ? '' : body.text.slice(0, 2000), truncated: body.truncated };
  }

  // The live run for one use case. Never throws for a refusal by PingOne or a network failure (those are hops with a verdict); throws LiveRefused('busy')
  // when two live runs are already in flight.
  async function run(uc, { vertical, traceparent }) {
    if (!configured()) throw new LiveRefused('not_configured', config.problem);
    if (inFlight >= MAX_IN_FLIGHT) throw new LiveRefused('busy', 'two live runs are already in flight; wait for one to finish');
    inFlight += 1;
    try {
      const trace = newTrace(traceparent, `live:${uc.id}`);
      const rootSpan = trace.span();
      const hops = []; const tokens = [];
      const tp = () => formatTraceparent(trace.traceId, trace.span());
      const push = (h) => hops.push({ n: hops.length + 1, mock: false, live: true, ...h });

      // 1. Discovery (public): what this environment advertises. Whether it advertises token exchange is read from the answer, not assumed.
      const d1 = tp();
      const disc = await call('discovery', d1);
      const meta = disc.json || {};
      const grants = Array.isArray(meta.grant_types_supported) ? meta.grant_types_supported.filter((g) => typeof g === 'string').slice(0, 30) : [];
      const discOk = disc.status === 200 && disc.json !== null;
      push({
        kind: 'live-discovery', label: 'Live: the identity provider\'s discovery document', from: 'lab', to: 'idp', verdict: discOk ? 'ok' : 'deny', traceparent: d1,
        note: discOk ? `This environment ${grants.includes(TOKEN_EXCHANGE) ? 'advertises' : 'does not advertise'} the RFC 8693 token-exchange grant (read from grant_types_supported).` : liveFailure(disc),
        request: { method: 'GET', url: urls.discovery, headers: { traceparent: d1 } },
        response: { status: disc.status, body: discOk ? { issuer: str(meta.issuer), token_endpoint: str(meta.token_endpoint), grant_types_supported: grants, token_endpoint_auth_methods_supported: strs(meta.token_endpoint_auth_methods_supported) } : failureBody(disc) },
      });

      // 2. The agent's own client-credentials token. The secret goes in the Authorization header only and is shown as write-only.
      const d2 = tp();
      const tok = await call('token', d2);
      const raw = tok.json && typeof tok.json.access_token === 'string' ? tok.json.access_token : null;
      const tokOk = tok.status === 200 && raw !== null;
      if (tokOk) {
        const dec = decodeJwt(raw);
        tokens.push({ label: 'agent client-credentials token (LIVE, masked)', mock: false, live: true, notice: 'LIVE token from your PingOne environment, shown masked (first 6 and last 4 characters): real credentials stay write-only (rule 4). The raw value is never returned or stored.', raw: mask(raw), header: dec?.header ?? null, claims: dec?.claims ?? { note: 'the token is opaque, not a JWT: there is nothing to decode' } });
      }
      push({
        kind: 'live-actor-token', label: 'Live: the agent gets its own token (client credentials)', from: 'lab', to: 'idp', verdict: tokOk ? 'ok' : 'deny', traceparent: d2,
        note: tokOk ? 'The lab used the worker client from the shared settings file as the agent client. The token is shown masked.' : liveFailure(tok),
        request: { method: 'POST', url: urls.token, headers: { traceparent: d2, 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic [write-only: the client secret is never shown]' }, body: { grant_type: 'client_credentials' } },
        response: { status: tok.status, body: tokOk ? { access_token: mask(raw), token_type: str(tok.json.token_type), expires_in: Number.isFinite(tok.json.expires_in) ? tok.json.expires_in : null, scope: str(tok.json.scope) } : failureBody(tok) },
      });

      const outcome = discOk && tokOk ? 'LIVE_OK' : (disc.unreachable || tok.unreachable) ? 'LIVE_UNREACHABLE' : 'LIVE_REFUSED';
      return {
        schema: 'customer-agent-run/1', mode: 'live', kind: 'live', useCase: { id: uc.id, track: uc.track, title: uc.title, maturity: uc.maturity, flag: uc.flag }, vertical,
        expectedOutcome: uc.expectedOutcome, live: { status: 'idp-only', message: NOT_RUN_REASON }, labSimulated: false, computed: false, persona: null, outcome, matchesExpected: null,
        // demo-hop/1 with tokens hidden: a live run is Real mode, so nothing token-shaped reaches the page (the token list keeps its own masked view).
        hops: hops.map((h) => enrichHop(h, HOP_CATALOG, undefined, { tokens: 'redact' })), tokens, traceId: trace.traceId, traceparent: formatTraceparent(trace.traceId, rootSpan), notRun: { reason: NOT_RUN_REASON, steps: chainOf(uc) },
        narration: outcome === 'LIVE_OK' ? `Live, identity provider only: the discovery document and the agent's client-credentials token came from your PingOne environment. "${uc.title}" was not run past that point.`
          : `Live, identity provider only: ${outcome === 'LIVE_UNREACHABLE' ? 'the identity provider did not answer' : 'the identity provider refused a call'}. "${uc.title}" was not run.`,
      };
    } finally { inFlight -= 1; }
  }

  return { configured, problem: () => (configured() ? null : config.problem), origin: () => (configured() ? new URL(config.base).origin : null), run };
}

// The one host the netguard may be told to allow: the configured PingOne host, and only when live is configured, the opt-in holds (refusal is null) and
// the host is not loopback (loopback is always allowed already). Anything else: null, and the netguard allows nothing.
export function hostToAllow(live, refusal) {
  if (refusal !== null || !live.configured()) return null;
  const host = new URL(live.origin()).hostname;
  return isLoopbackHost(host) ? null : host;
}

const str = (v) => (typeof v === 'string' ? v.slice(0, 300) : null);
const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 30).map((x) => x.slice(0, 80)) : []);
const liveFailure = (r) => (r.unreachable ? 'The identity provider did not answer (no connection, a timeout or an unreadable reply).' : r.redirected ? 'The identity provider answered with a redirect; the lab never follows one.' : r.truncated ? 'The reply was larger than the lab reads, so it was cut off.' : `The identity provider answered HTTP ${r.status}.`);
// A refusal's own error code and description are shown (they are PingOne's words), cut short; nothing else of the reply.
const failureBody = (r) => (r.json ? { error: str(r.json.error) ?? str(r.json.code), error_description: str(r.json.error_description) ?? str(r.json.message) } : { note: r.unreachable ? 'no reply' : 'the reply was not a JSON object' });
