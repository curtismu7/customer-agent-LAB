// Credential-shaped and personal-looking text. Anything a visitor types that looks like a token, a key, a password or key material is masked on the way IN
// (reason, comment) so the raw value never enters state, a receipt, an outbox entry, a hop pane, a log line or an error.
// Lab-written detectors; linear patterns only (no nested quantifiers), run on input capped at MAX_FREE characters.
export const MAX_FREE = 400;

const D = (id, re) => ({ id, re });
// Lab-written, heuristic detectors: they catch the common shapes, plain-language passwords and keys of 20 characters or more. Not every secret has a
// recognisable shape (a short random password with no keyword before it is not found), and the page says so.
export const DETECTORS = [
  D('private-key', /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----[^]{0,4000}?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g),
  D('url-userinfo', /\b[a-zA-Z][a-zA-Z0-9+.-]{1,20}:\/\/[^/\s:@]{1,100}:[^@\s]{1,200}@/g),
  D('github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,})/g),
  D('gitlab-token', /\bglpat-[A-Za-z0-9_-]{6,}/g),
  D('slack-token', /\bxox[abprs]-[A-Za-z0-9-]{6,}/g),
  D('aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g),
  D('google-token', /\b(?:ya29\.[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})/g),
  D('api-key', /\bsk-[A-Za-z0-9_-]{8,}/g),
  D('jwt', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g),
  D('bearer', /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{10,}/gi),
  // "token abcdef1234567890" (an Authorization header): the word needs a digit, so "token requirements" is left alone
  D('token-word', /\btoken\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi),
  // a passphrase is several words: take the next four
  D('passphrase', /\bpassphrase\s*(?:[:=]|\bis\b)\s*\S+(?:[ \t]+\S+){0,3}/gi),
  // "Authorization: Basic xxxx", "authorization = abc123..." (the whole header value)
  D('authorization', /\bauthorization\s*[:=]\s*\S{3,}(?:[ \t]+\S{6,})?/gi),
  // "my password is Tr0ub4dor", "the passcode was zebra-Quartz-77": plain-language password statements
  D('password-is', /\b(?:password|passwd|passcode|passkey|pwd|pw)s?\s+(?:is|are|was)\s+\S{3,}/gi),
  // "the secret is x1y2z3", "api key is ...": only when the value has a digit, so "the secret is stored in the vault" is left alone
  { id: 'secret-is', re: /\b(?:secret|token|api[ _-]?key|key|credential)s?\s+(?:is|are|was)\s+\S{4,}/gi, accept: (m) => /\d/.test(m.replace(/^\S+\s+\S+\s+/, '')) },
  D('pin', /\bpin(?:[ _-]?(?:code|number))?\s*(?:[:=]|\b(?:is|are|was)\b)\s*\d{3,8}\b/gi),
  D('assignment', /\b(?:password|passwd|passcode|passkey|pwd|pw|pass|secret(?:[ _-]?key)?|token|api[_-]?key|apikey|client[_-]?secret|private[_-]?key|access[_-]?key|account[_-]?key|session[_-]?id|sessionid|credential)s?\s*[:=]\s*\S{3,}/gi),
  // Personal-looking data: a US social security number, an email address, a payment card number (Luhn checked) and a phone number
  D('ssn', /\b\d{3}-\d{2}-\d{4}\b/g),
  D('email', /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}/g),
  { id: 'card', re: /\b\d(?:[ -]?\d){12,18}\b/g, accept: (m) => { const d = m.replace(/\D/g, ''); if (d.length < 13 || d.length > 19) return false; let sum = 0; for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 === 0; } },
  D('phone', /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}\b/g),
  D('phone-intl', /\+\d[\d ().-]{8,16}\d/g),
  // A long run of key characters. Two detectors, both checked in code rather than with a look-ahead (to stay linear): a run of 20 or more of
  // letters, digits, _ and - that has both a letter and a digit (or is 32 or more and is not just lowercase words joined by hyphens), and a run of 32 or
  // more that also uses + / = (base64) unless it is a lowercase path such as a URL path.
  { id: 'key-like', generic: true, re: /[A-Za-z0-9_-]{20,}/g, accept: (m) => (/\d/.test(m) && /[A-Za-z]/.test(m)) || (m.length >= 32 && !/^[a-z]+(?:-[a-z]+)+$/.test(m)) },
  { id: 'long-blob', generic: true, re: /[A-Za-z0-9+/_=-]{32,}/g, accept: (m) => !/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/.test(m) && !/^[a-z]+(?:-[a-z]+)+$/.test(m) },
];

const MAX_SCAN = 200000;
// Spans { start, end, id } of every credential-shaped run in the text.
export function findCredentials(text) {
  const t = String(text).slice(0, MAX_SCAN);
  const spans = [];
  for (const d of DETECTORS) { d.re.lastIndex = 0; for (const m of t.matchAll(d.re)) if (!d.accept || d.accept(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, id: d.id }); }
  return spans;
}

export function maskSpans(text, spans) {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = ''; let at = 0;
  for (const s of sorted) { if (s.start < at) { at = Math.max(at, s.end); continue; } out += `${text.slice(at, s.start)}[masked:${s.id}]`; at = s.end; }
  return out + text.slice(at);
}

export function maskText(input) {
  const text = String(input);
  return text ? maskSpans(text, findCredentials(text)) : text;
}

// Free text from the visitor: zero-width and bidi characters DELETED (so a token cannot be hidden by interleaving them), other control characters
// turned into spaces, credential-shaped runs masked, and only THEN cut to length (a token that straddles the cut is masked, not half shown).
export function cleanFree(value, max = MAX_FREE) {
  const flat = String(value ?? '').slice(0, MAX_SCAN).normalize('NFKC') // fullwidth look-alikes become the ASCII they imitate
    .replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  return maskText(flat).replace(/\s+/g, ' ').trim().slice(0, max);
}
