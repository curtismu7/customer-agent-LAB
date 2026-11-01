// Mock tokens. Every token this app mints is labelled MOCK, signed ES256 with a MOCK key that is built from a fixed 32-byte scalar with
// createECDH + createPrivateKey (never generateKeyPair: it aborted on Node 20 in CI). The scalar is public on purpose and protects nothing: anyone
// can forge a token for this mock issuer, which is the point of a mock. ECDSA signatures from Node are randomised, so a token's third segment
// differs between runs; everything else in a run record is deterministic.
import { createECDH, createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

const MOCK_SCALAR = createHash('sha256').update('customer-agent-lab mock signing key (public, protects nothing)').digest();
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function buildKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(MOCK_SCALAR);
  const pub = ecdh.getPublicKey(); // 0x04 | X | Y
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
  const privateKey = createPrivateKey({ key: { ...jwk, d: b64u(MOCK_SCALAR) }, format: 'jwk' });
  return { privateKey, publicKey: createPublicKey(privateKey), publicJwk: { ...jwk, use: 'sig', alg: 'ES256', kid: 'mock-key-1' } };
}
const KEYS = buildKeys();
export const MOCK_JWK = KEYS.publicJwk;

export function signMockJwt(claims, { typ = 'at+jwt' } = {}) {
  const header = { alg: 'ES256', typ, kid: MOCK_JWK.kid };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const sig = sign('sha256', Buffer.from(input), { key: KEYS.privateKey, dsaEncoding: 'ieee-p1363' });
  return { jwt: `${input}.${b64u(sig)}`, header, claims };
}

// Verifies a token this module signed (used by the tests and by the gateway-check hop). Returns { ok, header, claims } or { ok: false }.
export function verifyMockJwt(jwt) {
  if (typeof jwt !== 'string') return { ok: false };
  const parts = jwt.split('.');
  if (parts.length !== 3) return { ok: false };
  try {
    const ok = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: KEYS.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
    return ok ? { ok, header: JSON.parse(Buffer.from(parts[0], 'base64url')), claims: JSON.parse(Buffer.from(parts[1], 'base64url')) } : { ok: false };
  } catch { return { ok: false }; }
}

// What the UI shows for a token: the raw JWT (rule 4: tokens are shown raw, education) plus the decoded header and claims, all labelled MOCK.
export const tokenView = (label, signed) => ({ label, mock: true, notice: 'MOCK token, issued by this lab and signed with a public mock key', raw: signed.jwt, header: signed.header, claims: signed.claims });
