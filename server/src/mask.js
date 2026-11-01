// Defence in depth: every API response passes through maskDeep, so a credential-shaped value can never leave in any field even if a code path
// forgot to clean its input. Iterative: a deep structure cannot overflow the stack. The generic long-blob detector is NOT applied here
// (ids, hashes and trace ids are long and legitimate); the specific token, key, bearer and assignment detectors are.
// Rule 4 (tokens are shown raw, for education): the MOCK tokens this lab minted for the response are passed in `allowed` and are the ONLY
// credential-shaped strings left alone (exact match, swapped for a placeholder before masking and restored after). A token the visitor
// typed is never in that list, so it is masked like any other. Masking is a heuristic: not every secret has a recognisable shape.
import { DETECTORS, maskSpans } from './credentials.js';

const SPECIFIC = DETECTORS.filter((d) => !d.generic);
// Static catalog text (the committed use-case list and the story) is not visitor input and is plain product prose. The prose-style detectors ("bearer
// requirement", "authorization: x") would corrupt it, so for those answers only the credential SHAPES are applied. The doctor scans the same text with the same set.
export const SHAPE_IDS = new Set(['private-key', 'url-userinfo', 'github-token', 'gitlab-token', 'slack-token', 'aws-key', 'google-token', 'api-key', 'jwt']);
const SHAPES = SPECIFIC.filter((d) => SHAPE_IDS.has(d.id));
const OPAQUE = new Set(['hash', 'prevHash', 'traceparent', 'traceId', 'parentId', 'spanId']);

export function maskResponseText(text, allowed = [], shapesOnly = false) {
  let t = text;
  const kept = [];
  for (const tok of allowed) if (typeof tok === 'string' && tok.length > 20 && t.includes(tok)) { kept.push(tok); t = t.split(tok).join(`⟦T${kept.length - 1}⟧`); }
  const spans = [];
  for (const d of shapesOnly ? SHAPES : SPECIFIC) { d.re.lastIndex = 0; for (const m of t.matchAll(d.re)) if (!d.accept || d.accept(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, id: d.id }); }
  let out = spans.length ? maskSpans(t, spans) : t;
  kept.forEach((tok, i) => { out = out.split(`⟦T${i}⟧`).join(tok); });
  return out;
}

export function maskDeep(value, allowed = [], shapesOnly = false) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const root = { v: clone(value) };
  const work = [[value, root, 'v', false]];
  while (work.length) {
    const [src, dst, key, opaque] = work.pop();
    if (typeof src === 'string') { dst[key] = opaque ? src : maskResponseText(src, allowed, shapesOnly); continue; }
    if (src === null || typeof src !== 'object') { dst[key] = src; continue; }
    const copy = clone(src); dst[key] = copy;
    for (const k of Object.keys(src).reverse()) work.push([src[k], copy, k, OPAQUE.has(k)]);
  }
  return root.v;
}
