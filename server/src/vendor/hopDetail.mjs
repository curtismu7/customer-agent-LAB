// Vendored from AI-DEMO-Standalone shared/hop-detail/hopDetail.mjs @ 84222bf. Edit the shared copy first, then re-copy.
// hop-detail (shared, vendored): enrich a raw engine hop into demo-hop/1 using the hop catalog.
// Copy this file into an app as-is; see README.md in AI-DEMO-Standalone/shared/hop-detail. No dependencies.

// Keys are compared normalised: lower case, "-" and camelCase folded to "_" (clientSecret, client-secret -> client_secret).
const norm = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/-/g, '_');
const TOKEN_KEYS = new Set(['access_token', 'id_token', 'refresh_token', 'subject_token', 'actor_token', 'assertion', 'client_assertion', 'authorization', 'proxy_authorization', 'cookie', 'set_cookie', 'dpop', 'token', 'device_code', 'auth_req_id']);
// Always write-only, in Mock and Real: the rulebook keeps secrets and keys write-only.
const WRITE_ONLY = new Set(['client_secret', 'password', 'secret', 'api_key', 'x_api_key', 'apikey', 'private_key', 'privatekey', 'code_verifier']);
// A JWT's header always starts with base64url "{" ("eyJ"), which keeps dotted hostnames out of the match.
const JWT = /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/;
const JWT_IN_TEXT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const VERDICTS = new Set(['ok', 'deny', 'held', 'obligation', 'skip']);
const STAGE_RESULTS = new Set(['pass', 'fail', 'skip']);
const MAX_DEPTH = 40;
const own = (o, k) => o != null && typeof o === 'object' && Object.hasOwn(o, k);

function redactAuthValue(v, hide) {
  if (typeof v !== 'string') return hide ? '[redacted]' : v;
  if (/^basic\s/i.test(v)) return 'Basic [write-only]'; // base64 of id:secret
  if (/^(bearer|dpop)\s/i.test(v)) return hide ? `${v.split(/\s/)[0]} [redacted-jwt]` : v;
  return hide ? '[redacted]' : v;
}

function redactParams(text, hide) {
  // form bodies, query strings and URL fragments
  return text.replace(/(^|[?&#])([A-Za-z_][A-Za-z0-9_-]*)=([^&#\s]*)/g, (m, sep, name, v) => {
    const n = norm(name);
    if (WRITE_ONLY.has(n)) return `${sep}${name}=[write-only]`;
    if (hide && TOKEN_KEYS.has(n)) return `${sep}${name}=[redacted]`;
    return m;
  });
}

/**
 * Redact a request/response part. Returns a new value; never mutates; depth-limited and cycle-safe.
 * tokens: 'redact' (default; Real mode) hides tokens; 'raw' keeps them (Mock mode: the rulebook shows MOCK tokens raw for teaching).
 * Secrets and keys (client_secret, password, api keys, Basic credentials) are write-only in both modes.
 */
export function redact(value, key = '', tokens = 'redact', depth = 0, seen = new WeakSet()) {
  const k = norm(key);
  const hide = tokens !== 'raw';
  if (WRITE_ONLY.has(k)) return '[write-only]';
  if (k === 'authorization' || k === 'proxy_authorization') return redactAuthValue(value, hide);
  if (hide && TOKEN_KEYS.has(k) && value != null && value !== '') return '[redacted]';
  if (depth > MAX_DEPTH) return '[too deep]';
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return JSON.stringify(redact(JSON.parse(t), '', tokens, depth + 1, seen)); } catch { /* not JSON: treat as text */ }
    }
    if (hide && JWT.test(value)) return '[redacted-jwt]';
    const s = redactParams(value, hide);
    return hide ? s.replace(JWT_IN_TEXT, '[redacted-jwt]') : s;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[cycle]';
    seen.add(value);
    let out;
    if (Array.isArray(value)) {
      // header pairs: [['Authorization', 'Bearer ...'], ...]
      out = value.map((v) => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' ? [v[0], redact(v[1], v[0], tokens, depth + 1, seen)] : redact(v, '', tokens, depth + 1, seen)));
    } else {
      out = {};
      for (const k2 of Object.keys(value)) Object.defineProperty(out, k2, { value: redact(value[k2], k2, tokens, depth + 1, seen), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(value);
    return out;
  }
  return value;
}

const scopes = (s) => (typeof s === 'string' ? s.split(/\s+/).filter(Boolean) : Array.isArray(s) ? s : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Compare two claim sets. Ignores iat/nbf/exp/jti, which change on every mint. */
export function claimDiff(before = {}, after = {}) {
  const skip = new Set(['iat', 'nbf', 'exp', 'jti']);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !skip.has(k));
  const changed = keys.filter((k) => !same(before[k], after[k]));
  return { before, after, changed };
}

/** One line for a movie-reel frame, in AI-DEMO2's order: scope narrowed, act added, catalog fact, status. */
export function factFor(hop, entry) {
  const d = hop.claimDiff;
  if (d && d.changed.includes('scope')) {
    const a = scopes(d.before.scope).length, b = scopes(d.after.scope).length;
    if (a && b < a) return `scope narrowed ${a} → ${b}`;
  }
  if (d && d.changed.includes('act') && d.after.act?.sub) return `act +${d.after.act.sub}`;
  if (hop.verdict === 'deny') return 'denied';
  if (hop.verdict === 'held') return 'held';
  if (hop.verdict === 'obligation') return 'needs approval';
  return entry?.fact ?? (hop.verdict === 'skip' ? 'not in this path' : 'done');
}

/**
 * Enrich a raw engine hop. `extra` may carry { before, after } claim sets, stages, decision, kv.
 * opts.tokens: 'redact' (default) or 'raw' (Mock mode only). Unknown kinds get no spec; validateHop reports them.
 */
export function enrichHop(hop, catalog, extra = {}, opts = {}) {
  const tokens = opts.tokens === 'raw' ? 'raw' : 'redact';
  const entry = own(catalog?.kinds, hop.kind) ? catalog.kinds[hop.kind] : undefined;
  const out = {
    ...hop,
    request: redact(hop.request ?? {}, '', tokens),
    response: redact(hop.response ?? {}, '', tokens),
    title: entry?.title ?? hop.kind,
    narrative: hop.label ?? entry?.title ?? hop.kind,
  };
  if (entry?.spec) out.spec = entry.spec;
  if (extra.before || extra.after) out.claimDiff = claimDiff(extra.before, extra.after);
  if (extra.stages) out.stages = extra.stages;
  if (extra.decision) out.decision = extra.decision;
  if (extra.kv) out.kv = extra.kv;
  out.fact = factFor(out, entry);
  return out;
}

/** Problems with one hop; [] means it is valid demo-hop/1. opts.tokens 'raw' skips the leftover-JWT check (Mock mode). */
export function validateHop(h, catalog, opts = {}) {
  const p = [];
  if (!Number.isInteger(h?.n) || h.n < 1) p.push('n must be a positive integer');
  for (const f of ['kind', 'from', 'to', 'title', 'narrative', 'fact']) if (typeof h?.[f] !== 'string' || !h[f]) p.push(`${f} is required`);
  if (h && !VERDICTS.has(h.verdict ?? 'ok')) p.push(`verdict ${h.verdict} is not ok|deny|held|obligation|skip`);
  if (catalog && h?.kind && !own(catalog.kinds, h.kind)) p.push(`kind ${h.kind} has no catalog entry`);
  const s = h?.spec;
  if (!s) p.push('spec is required');
  else if (s.none) { if (!s.why || !s.failure) p.push('spec.none needs why and failure'); }
  else {
    for (const f of ['mandate', 'why', 'failure']) if (!s[f]) p.push(`spec.${f} is required`);
    if (!Array.isArray(s.refs) || !s.refs.length) p.push('spec.refs needs at least one reference');
    else for (const r of s.refs) if (!r.label || !/^https:\/\//.test(r.url ?? '')) p.push(`spec ref ${r.label ?? '?'} needs a label and an https url`);
  }
  if (h?.stages !== undefined && !Array.isArray(h.stages)) p.push('stages must be a list');
  else for (const st of h?.stages ?? []) if (!st || typeof st !== 'object' || !st.name || !STAGE_RESULTS.has(st.result)) p.push(`stage ${st?.name ?? '?'} needs a name and pass|fail|skip`);
  if (h?.kv !== undefined && (!Array.isArray(h.kv) || h.kv.some((r) => !Array.isArray(r) || r.length !== 2))) p.push('kv must be a list of [key, value] pairs');
  let text = '';
  try { text = JSON.stringify([h?.request, h?.response]); } catch { p.push('request or response cannot be serialised'); }
  if (opts.tokens !== 'raw' && JWT_IN_TEXT.test(text)) p.push('request or response still contains a JWT');
  JWT_IN_TEXT.lastIndex = 0;
  return p;
}
