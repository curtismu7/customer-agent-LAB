import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, portProblem, resolvePort, assertBindAllowed, bindHost, scanHosts, scanKeys, mockSignInRefusal, liveRefusal, notConfiguredText, allowedExtraHosts, PORT_MIN, PORT_MAX, DEFAULT_PORT } from '../src/safety.js';
import { rawHttp, withServer, get, post, MOCK_OK } from './helpers.js';

const ctx = (env = {}, bind = '127.0.0.1', headers = {}) => ({ env, bind, headers });

test('ports: 5600-5699 only, the default is 5600, the reserved ports are refused', () => {
  assert.deepEqual([PORT_MIN, PORT_MAX, DEFAULT_PORT], [5600, 5699, 5600]);
  for (const p of [5600, 5601, 5650, 5699]) assert.equal(portProblem(p), null, String(p));
  for (const p of [5599, 5700, 8080, 5173, 3000, 3900, 4000, 4400, 4510, 4600, 4601, 18080, 19080, 19090, 0, -1]) assert.ok(portProblem(p), String(p));
  assert.ok(portProblem(5600.5)); assert.ok(portProblem(NaN));
  assert.equal(resolvePort({}), 5600); assert.equal(resolvePort({ PORT: '5642' }), 5642); assert.throws(() => resolvePort({ PORT: '7300' }), /outside 5600-5699/);
});

test('loopback names are recognised; a lookalike is not', () => {
  for (const h of ['localhost', '127.0.0.1', '127.255.0.9', '::1', '[::1]', 'LOCALHOST']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['127.0.0.1.evil.example', 'evil.example', '128.0.0.1', '0.0.0.0', '127.0.0.256', '']) assert.equal(isLoopbackHost(h), false, h);
});

test('LAB_ALLOWED_HOSTS: validated host names only, empty by default, no hardcoded domain ships', () => {
  assert.deepEqual([...allowedExtraHosts({})], []);
  assert.deepEqual([...allowedExtraHosts({ LAB_ALLOWED_HOSTS: 'lab-a.local.ping-devops.com, Lab-B.local.ping-devops.com' })], ['lab-a.local.ping-devops.com', 'lab-b.local.ping-devops.com']);
  for (const bad of ['not a host', '../etc/passwd', 'a b', '-dot-', 'x'.repeat(300)]) assert.throws(() => allowedExtraHosts({ LAB_ALLOWED_HOSTS: bad }), /not a host name/, bad);
});

test('bind: loopback by default, anything else needs CALAB_BIND', () => {
  assert.equal(bindHost({}), '127.0.0.1'); assert.equal(bindHost({ CALAB_BIND: '0.0.0.0' }), '0.0.0.0');
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('0.0.0.0', { CALAB_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('rule 11 mock sign-in guards: every one of them alone refuses', () => {
  const ok = ctx({ ALLOW_MOCK_SIGNIN: '1' });
  assert.equal(mockSignInRefusal(ok), null);
  assert.match(mockSignInRefusal(ctx({})), /ALLOW_MOCK_SIGNIN=1/);
  for (const v of ['0', 'true', 'yes', '', ' 1']) assert.ok(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: v })), JSON.stringify(v));
  assert.match(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', IDP: 'live' })), /IDP is not mock/);
  assert.equal(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', IDP: 'mock' })), null);
  for (const h of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']) assert.match(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1' }, '127.0.0.1', { [h]: 'x' })), /proxy/, h);
  assert.match(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1' }, '0.0.0.0')), /non-loopback/);
  assert.equal(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', CAL_PUBLISH: 'loopback' }, '0.0.0.0')), null, 'Docker: a wide bind inside the container is fine when the compose publish is loopback-only');
  assert.ok(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', CAL_PUBLISH: 'lan' }, '0.0.0.0')));
  assert.equal(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', NODE_ENV: 'production' })), null, 'NODE_ENV is not a guard (the Docker image sets it)');
});

test('live mode guards (option a, owner 2026-11-10): no ON switch; CAL_ALLOW_LIVE=0 turns Real off, IDP unset or pingone, no proxy, loopback: every one alone refuses', () => {
  for (const env of [{}, { CAL_ALLOW_LIVE: '' }, { CAL_ALLOW_LIVE: '1' }, { IDP: 'pingone' }, { IDP: '' }, { CAL_ALLOW_LIVE: '1', IDP: 'pingone' }]) assert.equal(liveRefusal(ctx(env)), null, JSON.stringify(env));
  assert.equal(liveRefusal(ctx({ CAL_PUBLISH: 'loopback' }, '0.0.0.0')), null, 'Docker: a wide bind inside the container with a loopback-only publish');
  assert.match(liveRefusal(ctx({ CAL_ALLOW_LIVE: '0' })), /switched off.*CAL_ALLOW_LIVE=0/);
  for (const v of ['yes', 'true', ' 1', '2']) assert.match(liveRefusal(ctx({ CAL_ALLOW_LIVE: v })), /must be 0/, v);
  assert.match(liveRefusal(ctx({ IDP: 'mock' })), /pinned to mock/);
  assert.match(liveRefusal(ctx({ IDP: 'okta' })), /IDP=pingone only/);
  assert.match(liveRefusal(ctx({}, '127.0.0.1', { 'x-forwarded-for': '1' })), /proxy/);
  assert.match(liveRefusal(ctx({}, '0.0.0.0')), /non-loopback/);
  assert.match(liveRefusal(ctx({ CAL_DEPLOY_MODE: 'hosted' })), /hosted build/);
});

test('IDP is chosen per mode: unset allows both the mock sign-in and Real; mock pins Mock; pingone pins Real', () => {
  assert.equal(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1' })), null); assert.equal(liveRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1' })), null);
  assert.equal(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', IDP: '' })), null);
  assert.equal(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', IDP: 'mock' })), null); assert.ok(liveRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', IDP: 'mock' })));
  assert.ok(mockSignInRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', IDP: 'pingone' }))); assert.equal(liveRefusal(ctx({ ALLOW_MOCK_SIGNIN: '1', IDP: 'pingone' })), null);
});

test('the not-configured how-to names the missing settings (never a value) and where to fill them', () => {
  assert.match(notConfiguredText(['PINGONE_ENVIRONMENT_ID', 'PINGONE_CLIENT_SECRET']), /^Real is not configured: fill PINGONE_ENVIRONMENT_ID, PINGONE_CLIENT_SECRET in this app's \.env/);
  assert.match(notConfiguredText(), /valid PINGONE_\* values/);
});

test('only .example and .invalid hosts pass the host scan; fake keys must be sk-MOCK-', () => {
  assert.deepEqual(scanHosts('see https://gw.fabrikam.example/x and https://a.invalid and http://localhost:5600'), []);
  assert.deepEqual(scanHosts('https://api.vendor.com/x'), ['api.vendor.com']);
  assert.deepEqual(scanHosts('mail a@corp.com'), ['corp.com']); assert.deepEqual(scanHosts('10.0.0.1'), ['10.0.0.1']);
  assert.deepEqual(scanKeys('sk-MOCK-abcdefgh1234'), []); assert.equal(scanKeys('sk-abcdefgh1234').length, 1);
});

test('Host check: a non-loopback Host is refused (DNS rebinding); same-origin writes only', async () => {
  await withServer(async (url) => {
    const port = new URL(url).port;
    const bad = await rawHttp(url, { path: '/api/health', headers: { host: `evil.example:${port}` } });
    assert.equal(bad.status, 403); assert.equal(JSON.parse(bad.text).error, 'bad_host');
    assert.equal((await rawHttp(url, { headers: { host: `localhost:${port}` } })).status, 404);
    const cross = await post(url, '/api/reset', {}, { origin: 'http://evil.example' });
    assert.equal(cross.status, 403); assert.equal((await cross.json()).error, 'cross_origin');
    assert.equal((await post(url, '/api/reset', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post(url, '/api/reset', {}, { 'sec-fetch-site': 'same-origin' })).status, 200);
    assert.equal((await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200, 'no Origin header (curl, scripts) is allowed');
    assert.equal((await get(url, '/api/health', { origin: 'http://evil.example' })).status, 200, 'reads are not origin-gated');
  });
});

test('no hardcoded proxy domain in the shipped source: extra hosts come from LAB_ALLOWED_HOSTS only', async () => {
  const src = await import('node:fs').then((fs) => fs.promises.readFile(new URL('../src/safety.js', import.meta.url), 'utf8'));
  assert.ok(!/local\.ping-devops\.com/.test(src), 'safety.js must not hardcode a domain');
  await withServer(async (url) => {
    const port = new URL(url).port;
    const allowed = await rawHttp(url, { path: '/api/health', headers: { host: `lab-y.local.ping-devops.com:${port}` } });
    assert.equal(allowed.status, 403, 'an unconfigured proxy Host is still refused');
  }, { env: { ...MOCK_OK, LAB_ALLOWED_HOSTS: 'lab-x.local.ping-devops.com' } });
  await withServer(async (url) => {
    const port = new URL(url).port;
    const ok = await rawHttp(url, { path: '/api/health', headers: { host: `lab-x.local.ping-devops.com:${port}` } });
    assert.ok(ok.status !== 403, 'a configured proxy Host passes the host check');
    const write = await rawHttp(url, { method: 'POST', path: '/api/reset', headers: { host: `lab-x.local.ping-devops.com:${port}`, origin: 'https://lab-x.local.ping-devops.com:8443' } });
    assert.equal(write.status, 403, 'a same-site-but-different-origin write is still refused (no hardcoded origin exemption)');
  }, { env: { ...MOCK_OK, LAB_ALLOWED_HOSTS: 'lab-x.local.ping-devops.com' } });
});
