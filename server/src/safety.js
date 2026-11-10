// Safety rules. Pure functions plus two tiny middlewares. No I/O.
//  1. Loopback bind only unless CALAB_BIND is set on purpose.
//  2. Host header must be a loopback name (DNS-rebinding defence).
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused.
//  4. Every host in any shipped text is reserved (.invalid / .example / apex of example.com|net|org).
//  5. Ports are 5600-5699 and never one of the forbidden ones.
//  6. Every key-looking string is an obviously fake sk-MOCK- value.
//  7. Rule 11 guards (mockSignInRefusal, liveRefusal) at the bottom.
//  8. The hosted build (CAL_DEPLOY_MODE=hosted): live is refused outright, and the mock sign-in is allowed behind the cluster's ingress.

import { isHosted } from './config.js';

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.CALAB_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.CALAB_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set CALAB_BIND to opt in.`);
}

export const PORT_MIN = 5600;
export const PORT_MAX = 5699;
export const DEFAULT_PORT = 5600;
const FORBIDDEN_PORTS = new Set([8080, 5173, 3000, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090]);
export function portProblem(port) {
  if (!Number.isInteger(port)) return 'PORT is not an integer';
  if (FORBIDDEN_PORTS.has(port)) return `port ${port} is reserved for something else`;
  if (port < PORT_MIN || port > PORT_MAX) return `port ${port} is outside ${PORT_MIN}-${PORT_MAX}`;
  return null;
}
export function resolvePort(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  if (problem) throw new Error(problem);
  return port;
}

export function isReservedHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return /(^|\.)(invalid|example)$/.test(h);
}

const NETWORK_URL = /\b(?:https?|wss?|ftp|sftp|ssh|smtp|tcp|udp):\/\/([^\s/?#"'<>\\]+)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const stripAuthority = (a) => a.replace(/^[^@]*@/, '').replace(/:\d+$/, '');

// Every hostname or IP in text that is not reserved. Loopback names in URLs are allowed. Empty = clean.
export function scanHosts(text) {
  const found = new Set();
  const s = String(text);
  for (const m of s.matchAll(NETWORK_URL)) found.add(stripAuthority(m[1]).toLowerCase());
  for (const m of s.matchAll(EMAIL)) found.add(m[1].toLowerCase());
  for (const m of s.matchAll(IPV4)) found.add(m[0]);
  return [...found].filter((h) => !isReservedHost(h) && !isLoopbackHost(h)).sort();
}

// Any "sk-" secret that is not an obviously fake sk-MOCK- value. Empty = clean.
export function scanKeys(text) {
  return [...String(text).matchAll(/\bsk-(?!MOCK-)[A-Za-z0-9_-]{8,}/g)].map((m) => `${m[0].slice(0, 8)}...`);
}

// Free text from a caller (custodian, description): control characters stripped, length capped. Rendered as text, never as markup.
export function cleanText(value, max = 80) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
}

// Family standard (lab-proxy path mode): extra Host names via this lab's own env namespace, comma separated
// validated host names that point at this Mac (no hardcoded domain is shipped). Loopback always works.
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function allowedExtraHosts(env = process.env) {
  const extra = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const h of extra) if (!HOSTNAME.test(h)) throw new Error(`LAB_ALLOWED_HOSTS: not a host name: ${h}`);
  return new Set(extra);
}
export function hostCheck(req, res, next, extraHosts = allowedExtraHosts()) {
  const raw = String(req.headers.host || '');
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.replace(/:\d+$/, '');
  const set = extraHosts;
  const h = String(raw ?? '').toLowerCase();
  if (!isLoopbackHost(host) && !set.has(h) && !set.has(h.replace(/:\d+$/, ''))) return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
  next();
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function sameOriginWrites(req, res, next, { proxyOrigin = null, extraHosts = new Set() } = {}) {
  if (!WRITE.has(req.method)) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      const u = new URL(origin);
      const hostRaw = String(req.headers.host || '').toLowerCase();
      const hostBare = hostRaw.replace(/:\d+$/, '');
      // Same origin, or the shelf's own origin (the lab-proxy, given by the caller from SHELF_URL) while the Host the request was
      // sent to is loopback or one this lab allows (fleet pattern: proxy-origin write acceptance).
      ok = u.host.toLowerCase() === hostRaw
        || (proxyOrigin !== null && u.origin === proxyOrigin && !u.username && !u.password && (isLoopbackHost(hostBare) || extraHosts.has(hostBare)));
    } catch { /* malformed */ }
    if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  }
  next();
}

// ---- Rule 11 guards ----------------------------------------------------------------------------------------------------------
// IDP is chosen per mode (owner, 2026-11-10): unset (the default, and what Docker runs) means a Mock run uses the mock IdP and a Real run uses PingOne,
// so the toggle switches both ways without a restart. IDP=mock pins the lab to Mock (Real refused); IDP=pingone pins it to Real (mock sign-in refused).
// Mock sign-in (the persona picker that starts every MOCK run) needs ALL of: IDP unset or mock, ALLOW_MOCK_SIGNIN=1, no proxy headers, and a
// loopback bind (or Docker, whose compose file publishes on the Mac's 127.0.0.1 alone: CAL_PUBLISH=loopback). NODE_ENV is NOT a guard: the Docker
// image runs with NODE_ENV=production on purpose. Returns null when allowed, or the fixed reason it is refused (never echoes input).
const LOOPBACK_BIND = new Set(['127.0.0.1', '::1', 'localhost']);
export const FORWARDED = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'];

// The one proxy the owner runs: the shared lab-proxy, whose origin is SHELF_URL. When the request carries exactly its two headers
// (X-Forwarded-Host = that host, X-Forwarded-Proto = that scheme) and nothing else that names a proxy or a client address, the pair is
// dropped so the MOCK sign-in guard can run on the rest. Any other proxy header, or a mismatch, keeps the headers whole (refused).
// Used for mock sign-in only: live mode never gets this exception.
export function trustedProxyHeaders(headers, proxyOrigin) {
  if (!proxyOrigin || !headers) return headers;
  let u; try { u = new URL(proxyOrigin); } catch { return headers; }
  const ours = String(headers['x-forwarded-host'] ?? '').toLowerCase() === u.host.toLowerCase()
    && String(headers['x-forwarded-proto'] ?? '').toLowerCase() === u.protocol.replace(':', '');
  const others = ['forwarded', 'x-forwarded-for', 'x-real-ip'].some((h) => headers[h] !== undefined);
  if (!ours || others) return headers;
  const { 'x-forwarded-host': _h, 'x-forwarded-proto': _p, ...rest } = headers;
  return rest;
}

function networkRefusal({ env, bind, headers }) {
  if (FORWARDED.some((h) => headers?.[h] !== undefined)) return 'Refused behind a proxy.';
  if (!LOOPBACK_BIND.has(bind) && env.CAL_PUBLISH !== 'loopback') return 'Refused on a non-loopback address.';
  return null;
}

// In the hosted build the proxy and bind checks do not apply: the pod is reached only through the cluster's ingress (so every request carries
// proxy headers), live is refused, and everything a visitor sees is simulated and labelled so (the hosted banner). IDP and ALLOW_MOCK_SIGNIN still hold.
export function mockSignInRefusal({ env, bind, headers }) {
  if (env.IDP && env.IDP !== 'mock') return 'Mock sign-in is off: IDP is not mock.';
  if (env.ALLOW_MOCK_SIGNIN !== '1') return 'Mock sign-in is off. Start the lab with ALLOW_MOCK_SIGNIN=1 to allow it on this machine.';
  if (isHosted(env)) return null;
  const net = networkRefusal({ env, bind, headers });
  return net ? `Mock sign-in: ${net.charAt(0).toLowerCase()}${net.slice(1)}` : null;
}

// Real (live) may be selected (the toggle) only when ALL of the following hold, and every live run asks again (CAL_LAB_MODE=live only sets the opening
// mode and does not check them). Option (a), owner 2026-11-10 (rule 19, "Real if configured"): there is no ON switch to remember; Real is available
// when the app's .env holds complete PingOne settings (checked by the caller with live.configured()), and CAL_ALLOW_LIVE=0 is the explicit OFF switch
// (any value but unset, empty, 0 or 1 is refused, never guessed). IDP must be unset (per mode) or pingone (the one live provider this lab can reach;
// mock pins Mock and any other value is not supported), no proxy headers, and a loopback bind (or CAL_PUBLISH=loopback, Docker).
export const LIVE_IDP = 'pingone';
export const HOSTED_LIVE_REFUSAL = 'Live mode is not available in the hosted build: it is mock only. Run the lab locally for Real.';
export function liveRefusal({ env, bind, headers }) {
  if (isHosted(env)) return HOSTED_LIVE_REFUSAL;
  if (env.CAL_ALLOW_LIVE === '0') return 'Real is switched off on this machine (CAL_ALLOW_LIVE=0). Remove it to allow Real.';
  if (![undefined, '', '1'].includes(env.CAL_ALLOW_LIVE)) return 'CAL_ALLOW_LIVE must be 0 (Real off) or unset.';
  if (env.IDP === 'mock') return 'Real is off: IDP is pinned to mock. Leave IDP unset to switch between Mock and Real.';
  if (env.IDP && env.IDP !== LIVE_IDP) return `Live mode supports IDP=${LIVE_IDP} only.`;
  const net = networkRefusal({ env, bind, headers });
  return net ? `Live mode: ${net.charAt(0).toLowerCase()}${net.slice(1)}` : null;
}

// The how-to the Real button shows (and the 409 says) when the guards hold but the PingOne settings are missing. Names only, never a value.
export const notConfiguredText = (missing = [], problem = null) => `Real is not configured: ${missing.length ? `fill ${missing.join(', ')}` : problem ? `${problem}; fix it` : 'fill the full-Real settings'} in this app's .env beside docker-compose.yml (copy .env.example; PINGONE_REGION is com, eu, ca or asia), then start the lab again (Docker: docker compose up -d).`;
