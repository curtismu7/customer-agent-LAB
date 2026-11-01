// Rule 14: W3C Trace Context on every (mock) hop. One trace id per run, a new span id per hop. A valid incoming `traceparent` header continues its
// trace; anything else starts a new one. Nothing is sent anywhere: these are the raw request/response panes the UI shows. Ids are derived from a
// seed with SHA-256, so a run is deterministic; they carry no meaning outside this app.
import { createHash, randomBytes } from 'node:crypto';

const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);

export function parseTraceparent(v) {
  if (typeof v !== 'string' || v.length !== 55) return null;
  const m = TP.exec(v);
  return m && m[1] !== ZERO32 && m[2] !== ZERO16 ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}
export const formatTraceparent = (traceId, spanId, flags = '01') => `00-${traceId}-${spanId}-${flags}`;
const hex = (seed, n) => createHash('sha256').update(String(seed)).digest('hex').slice(0, n).replace(new RegExp(`^0{${n}}$`), `${'0'.repeat(n - 1)}1`);

// seed: any string that makes this run's ids reproducible. incoming: a traceparent header value, or undefined.
export function newTrace(incoming, seed = 'run') {
  const p = parseTraceparent(incoming);
  const traceId = p ? p.traceId : hex(`trace:${seed}`, 32);
  let n = 0;
  return { traceId, parentId: p ? p.parentId : null, span: () => hex(`span:${traceId}:${n++}`, 16) };
}

// A fresh, random traceparent for a caller that sent none (or a malformed one): each such run starts its own trace instead of every run sharing the seeded id.
// The id is random, so it is never reproducible; the browser always sends its own.
export function randomTraceparent() {
  const b = randomBytes(24);
  b[15] |= 1; b[23] |= 1; // never an all-zero id
  return formatTraceparent(b.subarray(0, 16).toString('hex'), b.subarray(16).toString('hex'));
}
