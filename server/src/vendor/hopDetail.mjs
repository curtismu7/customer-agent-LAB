// Vendored from AI-DEMO-Standalone shared/hop-detail/hopDetail.mjs @ 26888ea. Edit the shared copy first, then re-copy.
// hop-detail (shared, vendored): enrich a raw engine hop into demo-hop/1 using the hop catalog.
// Copy this file into an app as-is; see README.md in AI-DEMO-Standalone/shared/hop-detail. No dependencies.

const TOKEN_KEYS = new Set(['access_token', 'id_token', 'refresh_token', 'subject_token', 'actor_token', 'assertion', 'client_assertion', 'authorization', 'cookie', 'set-cookie', 'dpop']);
const WRITE_ONLY = new Set(['client_secret', 'password']);
const JWT = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/;
const JWT_IN_TEXT = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const VERDICTS = new Set(['ok', 'deny', 'held', 'obligation', 'skip']);
const STAGE_RESULTS = new Set(['pass', 'fail', 'skip']);

/**
 * Redact a request/response part. Returns a new value; never mutates.
 * tokens: 'redact' (default; Real mode) hides tokens; 'raw' keeps them (Mock mode: the rulebook shows MOCK tokens raw for teaching).
 * Secrets (client_secret, password) are write-only in both modes.
 */
export function redact(value, key = '', tokens = 'redact') {
  const k = String(key).toLowerCase();
  if (WRITE_ONLY.has(k)) return '[write-only]';
  const hide = tokens !== 'raw';
  if (hide && TOKEN_KEYS.has(k) && value != null && value !== '') return typeof value === 'string' && /^bearer\s/i.test(value) ? 'Bearer [redacted-jwt]' : '[redacted]';
  if (typeof value === 'string') {
    if (hide && JWT.test(value)) return '[redacted-jwt]';
    // form bodies and query strings: redact token-bearing params, then any JWT left in the text
    let s = value.replace(/(^|[?&])([A-Za-z_]+)=([^&\s]*)/g, (m, sep, name, v) => {
      const n = name.toLowerCase();
      if (WRITE_ONLY.has(n)) return `${sep}${name}=[write-only]`;
      if (hide && TOKEN_KEYS.has(n)) return `${sep}${name}=[redacted]`;
      return m;
    });
    return hide ? s.replace(JWT_IN_TEXT, '[redacted-jwt]') : s;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, '', tokens));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k2, v]) => [k2, redact(v, k2, tokens)]));
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
  const entry = catalog?.kinds?.[hop.kind];
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
  if (catalog && h?.kind && !catalog.kinds?.[h.kind]) p.push(`kind ${h.kind} has no catalog entry`);
  const s = h?.spec;
  if (!s) p.push('spec is required');
  else if (s.none) { if (!s.why || !s.failure) p.push('spec.none needs why and failure'); }
  else {
    for (const f of ['mandate', 'why', 'failure']) if (!s[f]) p.push(`spec.${f} is required`);
    if (!Array.isArray(s.refs) || !s.refs.length) p.push('spec.refs needs at least one reference');
    else for (const r of s.refs) if (!r.label || !/^https:\/\//.test(r.url ?? '')) p.push(`spec ref ${r.label ?? '?'} needs a label and an https url`);
  }
  for (const st of h?.stages ?? []) if (!st.name || !STAGE_RESULTS.has(st.result)) p.push(`stage ${st.name ?? '?'} needs a name and pass|fail|skip`);
  const text = JSON.stringify([h?.request, h?.response]);
  if (opts.tokens !== 'raw' && JWT_IN_TEXT.test(text)) p.push('request or response still contains a JWT');
  JWT_IN_TEXT.lastIndex = 0;
  return p;
}
