import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { MOCK_JWK, signMockJwt, verifyMockJwt, tokenView } from '../src/mockjwt.js';

test('a mock token is ES256, has the mock kid, and verifies with the PUBLIC mock JWK alone', () => {
  const t = signMockJwt({ sub: 'x', n: 1 });
  const [h, p, s] = t.jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', typ: 'at+jwt', kid: 'mock-key-1' });
  assert.equal(Buffer.from(s, 'base64url').length, 64, 'P-256 signature in IEEE P1363 form');
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: MOCK_JWK.x, y: MOCK_JWK.y }, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true);
  assert.equal(MOCK_JWK.d, undefined, 'the published JWK has no private part');
});

const flip = (sig) => { const b = Buffer.from(sig, 'base64url'); b[0] ^= 0xff; return b.toString('base64url'); };

test('a changed payload, header, signature, wrong shape or non-string fails verification', () => {
  const t = signMockJwt({ sub: 'x' }).jwt; const [h, p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url');
  for (const bad of [`${h}.${forged}.${s}`, `${h}x.${p}.${s}`, `${h}.${p}.${flip(s)}`, `${h}.${p}`, `${t}.extra`, '', 'a.b.c', null, undefined, 42, {}]) assert.equal(verifyMockJwt(bad).ok, false, String(bad));
  assert.equal(verifyMockJwt(t).ok, true);
});

test('signatures are randomised (so a token\'s third segment differs) but the signed content is identical', () => {
  const a = signMockJwt({ sub: 'x' }).jwt.split('.'); const b = signMockJwt({ sub: 'x' }).jwt.split('.');
  assert.deepEqual(a.slice(0, 2), b.slice(0, 2)); assert.notEqual(a[2], b[2]);
});

test('the token view is labelled MOCK with a notice, the raw token and the decoded header and claims', () => {
  const v = tokenView('user token (MOCK)', signMockJwt({ sub: 's' }));
  assert.equal(v.mock, true); assert.match(v.notice, /MOCK token/); assert.equal(v.claims.sub, 's'); assert.equal(v.header.alg, 'ES256'); assert.match(v.raw, /^eyJ/);
});
