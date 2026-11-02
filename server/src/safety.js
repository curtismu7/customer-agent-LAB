// Safety rules. Pure functions plus two tiny middlewares. No I/O.
//  1. Loopback bind only unless CALAB_BIND is set on purpose.
//  2. Host header must be a loopback name (DNS-rebinding defence).
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused.
//  4. Every host in any shipped text is reserved (.invalid / .example / apex of example.com|net|org).
//  5. Ports are 5600-5699 and never one of the forbidden ones.
//  6. Every key-looking string is an obviously fake sk-MOCK- value.
//  7. Rule 11 guards (mockSignInRefusal, liveRefusal) at the bottom.

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

export function hostCheck(req, res, next) {
  const raw = String(req.headers.host || '');
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.replace(/:\d+$/, '');
  if (!isLoopbackHost(host)) return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
  next();
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function sameOriginWrites(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { /* malformed */ }
    if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  }
  next();
}

// ---- Rule 11 guards ----------------------------------------------------------------------------------------------------------
// Mock sign-in (the persona picker that starts every run) needs ALL of: IDP=mock (the default), ALLOW_MOCK_SIGNIN=1, no proxy headers, and a
// loopback bind (or Docker, whose compose file publishes on the Mac's 127.0.0.1 alone: CAL_PUBLISH=loopback). NODE_ENV is NOT a guard: the Docker
// image runs with NODE_ENV=production on purpose. Returns null when allowed, or the fixed reason it is refused (never echoes input).
const LOOPBACK_BIND = new Set(['127.0.0.1', '::1', 'localhost']);
export const FORWARDED = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'];

function networkRefusal({ env, bind, headers }) {
  if (FORWARDED.some((h) => headers?.[h] !== undefined)) return 'Refused behind a proxy.';
  if (!LOOPBACK_BIND.has(bind) && env.CAL_PUBLISH !== 'loopback') return 'Refused on a non-loopback address.';
  return null;
}

export function mockSignInRefusal({ env, bind, headers }) {
  if ((env.IDP ?? 'mock') !== 'mock') return 'Mock sign-in is off: IDP is not mock.';
  if (env.ALLOW_MOCK_SIGNIN !== '1') return 'Mock sign-in is off. Start the lab with ALLOW_MOCK_SIGNIN=1 to allow it on this machine.';
  const net = networkRefusal({ env, bind, headers });
  return net ? `Mock sign-in: ${net.charAt(0).toLowerCase()}${net.slice(1)}` : null;
}

// Live mode may be selected (the toggle) only when ALL of the following hold, and every live run asks again (CAL_LAB_MODE=live only sets the opening mode and does not check them): the owner opted in (CAL_ALLOW_LIVE=1, lab-invented key), IDP=pingone (the one live provider
// this lab can reach; mock turns live off and any other value is not supported), no proxy headers, and a loopback bind (or CAL_PUBLISH=loopback).
export const LIVE_IDP = 'pingone';
export function liveRefusal({ env, bind, headers }) {
  if (env.CAL_ALLOW_LIVE !== '1') return 'Live mode is off. The owner enables it on this machine with CAL_ALLOW_LIVE=1.';
  if ((env.IDP ?? 'mock') === 'mock') return 'Live mode needs IDP set to a live provider (it is mock).';
  if (env.IDP !== LIVE_IDP) return `Live mode supports IDP=${LIVE_IDP} only.`;
  const net = networkRefusal({ env, bind, headers });
  return net ? `Live mode: ${net.charAt(0).toLowerCase()}${net.slice(1)}` : null;
}
