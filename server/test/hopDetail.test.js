// Vendored from AI-DEMO-Standalone shared/hop-detail/hopDetail.test.mjs @ 84222bf (paths adjusted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { redact, claimDiff, enrichHop, validateHop, factFor } from '../src/vendor/hopDetail.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(here, '../src/vendor/hop-catalog.json'), 'utf8'));
// A fake JWT-shaped string, built at runtime so secret scanners do not flag a literal.
const jwt = ['eyJhbGciOiJFUzI1NiJ9', 'eyJzdWIiOiJhbGV4Lm1vcmdhbiJ9', 'c2lnbmF0dXJlLXNpZ25hdHVyZQ'].join('.');
const raw = (over = {}) => ({ n: 4, kind: 'token-exchange', label: 'Token exchange', from: 'bff', to: 'idp', verdict: 'ok', traceparent: '00-a-b-01',
  request: { method: 'POST', url: 'https://idp.mock.example/as/token', headers: { authorization: `Bearer ${jwt}` }, body: `grant_type=x&subject_token=${jwt}&client_secret=s3cret&scope=balance:read` },
  response: { status: 200, body: { access_token: jwt, scope: 'balance:read' } }, ...over });

test('every catalog entry has a spec with refs or an explicit none', () => {
  for (const [k, e] of Object.entries(catalog.kinds)) {
    assert.ok(e.title && e.fact, `${k} title/fact`);
    const h = enrichHop({ n: 1, kind: k, label: k, from: 'a', to: 'b' }, catalog);
    assert.deepEqual(validateHop(h, catalog), [], k);
  }
});

test('catalog carries no real hosts: only .example/.invalid or spec sites', () => {
  const urls = JSON.stringify(catalog).match(/https?:\/\/[^\s"]+/g) ?? [];
  const ok = /^https:\/\/(www\.rfc-editor\.org|openid\.net|modelcontextprotocol\.io|a2a-protocol\.org|docs\.oasis-open\.org)\//;
  for (const u of urls) assert.match(u, ok);
  assert.doesNotMatch(JSON.stringify(catalog), /ping-devops|localhost|127\.0\.0\.1/);
});

test('redact: token keys, bearer header, form params, write-only, stray JWTs', () => {
  const r = enrichHop(raw(), catalog);
  assert.equal(r.request.headers.authorization, 'Bearer [redacted-jwt]');
  assert.match(r.request.body, /subject_token=\[redacted\]/);
  assert.match(r.request.body, /client_secret=\[write-only\]/);
  assert.match(r.request.body, /scope=balance:read/);
  assert.equal(r.response.body.access_token, '[redacted]');
  assert.equal(redact(`see ${jwt} here`), 'see [redacted-jwt] here');
  assert.equal(redact({ password: 'x' }).password, '[write-only]');
  assert.ok(!JSON.stringify(r).includes(jwt));
});

test('raw mode (Mock) keeps tokens but still hides secrets', () => {
  const r = enrichHop(raw(), catalog, {}, { tokens: 'raw' });
  assert.ok(r.request.body.includes(jwt));
  assert.equal(r.response.body.access_token, jwt);
  assert.match(r.request.body, /client_secret=\[write-only\]/);
  assert.deepEqual(validateHop(r, catalog, { tokens: 'raw' }), []);
});

test('obligation verdict is valid and gets its own fact', () => {
  const h = enrichHop(raw({ kind: 'authorize-decision', verdict: 'obligation' }), catalog);
  assert.equal(h.fact, 'needs approval');
  assert.deepEqual(validateHop(h, catalog), []);
});

test('review fixes: secrets are write-only in every shape, in both modes', () => {
  for (const mode of ['raw', 'redact']) {
    assert.equal(redact({ authorization: 'Basic Y2xpZW50OnMzY3JldA==' }, '', mode).authorization, 'Basic [write-only]');
    assert.equal(redact('{"client_secret":"s3cret"}', '', mode), '{"client_secret":"[write-only]"}');
    for (const key of ['clientSecret', 'client-secret', 'x-api-key', 'api_key', 'private_key', 'Password']) assert.equal(redact({ [key]: 'v' }, '', mode)[key], '[write-only]', key);
    assert.match(redact('client_secret=abc&scope=x', '', mode), /client_secret=\[write-only\]&scope=x/);
  }
});

test('review fixes: Real mode hides tokens in fragments, header pairs and JSON-string bodies', () => {
  assert.equal(redact('https://app.example/cb#access_token=opaque123&state=s'), 'https://app.example/cb#access_token=[redacted]&state=s');
  assert.deepEqual(redact([['Authorization', 'Bearer opaque']]), [['Authorization', 'Bearer [redacted-jwt]']]);
  assert.equal(redact(JSON.stringify({ access_token: 'opaque' })), '{"access_token":"[redacted]"}');
  assert.equal(redact('https://customer.gateway-lab.integration.example/x'), 'https://customer.gateway-lab.integration.example/x');
});

test('review fixes: deep, cyclic and prototype-shaped input does not throw', () => {
  let deep = {}; const top = deep; for (let i = 0; i < 20000; i++) { deep.a = {}; deep = deep.a; }
  assert.doesNotThrow(() => redact(top));
  const cyc = { a: 1 }; cyc.self = cyc;
  assert.equal(redact(cyc).self, '[cycle]');
  const out = redact(JSON.parse('{"__proto__":{"polluted":1}}'));
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  for (const kind of ['constructor', '__proto__', 'toString']) assert.ok(validateHop({ n: 1, kind, from: 'a', to: 'b', title: 't', narrative: 'n', fact: 'f', spec: { none: true, why: 'w', failure: 'f' } }, catalog).some((p) => /no catalog entry/.test(p)), kind);
  assert.equal(enrichHop({ n: 1, kind: '__proto__', from: 'a', to: 'b' }, catalog).spec, undefined);
});

test('review fixes: validateHop reports bad stages and kv instead of throwing', () => {
  const base = enrichHop(raw(), catalog);
  assert.ok(validateHop({ ...base, stages: { a: 1 } }, catalog).includes('stages must be a list'));
  assert.ok(validateHop({ ...base, stages: [null] }, catalog).some((p) => /stage \?/.test(p)));
  assert.ok(validateHop({ ...base, kv: [['only-one']] }, catalog).some((p) => /kv/.test(p)));
});

test('review fixes: enrichHop keeps kv, and spec refs must be https (mutation guards)', () => {
  assert.deepEqual(enrichHop(raw(), catalog, { kv: [['grant_type', 'token-exchange']] }).kv, [['grant_type', 'token-exchange']]);
  const h = enrichHop(raw(), catalog);
  const bad = { ...h, spec: { ...h.spec, refs: [{ label: 'x', url: 'http://www.rfc-editor.org/rfc/rfc8693' }] } };
  assert.ok(validateHop(bad, catalog).some((p) => /https url/.test(p)));
});

test('redact does not mutate the engine hop', () => {
  const h = raw(); enrichHop(h, catalog);
  assert.ok(h.request.body.includes(jwt));
});

test('claimDiff ignores time claims and lists changes', () => {
  const d = claimDiff({ sub: 'u', aud: 'bff', scope: 'a b c d', iat: 1 }, { sub: 'u', aud: 'gw', scope: 'a', act: { sub: 'agent' }, iat: 2 });
  assert.deepEqual(d.changed.sort(), ['act', 'aud', 'scope']);
});

test('fact follows AI-DEMO2 priority', () => {
  const h = enrichHop(raw(), catalog, { before: { scope: 'a b c d' }, after: { scope: 'a', act: { sub: 'agent' } } });
  assert.equal(h.fact, 'scope narrowed 4 → 1');
  const h2 = enrichHop(raw(), catalog, { before: { scope: 'a' }, after: { scope: 'a', act: { sub: 'agent' } } });
  assert.equal(h2.fact, 'act +agent');
  assert.equal(factFor({ verdict: 'deny' }, catalog.kinds['gateway-check']), 'denied');
  assert.equal(enrichHop(raw({ kind: 'gateway-check' }), catalog).fact, 'filter chain passed');
});

test('validateHop catches unknown kinds, bad stages and leftover JWTs', () => {
  assert.ok(validateHop(enrichHop(raw({ kind: 'nope' }), catalog), catalog).some((p) => /no catalog entry/.test(p)));
  const bad = enrichHop(raw(), catalog, { stages: [{ name: 'Audience', result: 'maybe' }] });
  assert.ok(validateHop(bad, catalog).some((p) => /pass\|fail\|skip/.test(p)));
  const leaked = { ...enrichHop(raw(), catalog), response: { body: jwt } };
  assert.ok(validateHop(leaked, catalog).some((p) => /JWT/.test(p)));
  assert.deepEqual(validateHop(enrichHop(raw(), catalog), catalog), []);
});
