// A fake PingOne on a loopback port, for the live-mode tests and the e2e. It is not PingOne: it answers the paths live mode and full Real call and records
// what it was sent. The client ids and secrets and the demo password are assembled at run time, so no credential-shaped string sits in the repository.
// Full Real (owner, 2026-11-10): authorize with response_mode=pi.flow (anything else is refused: there is no redirect login), the flows API
// username/password step, resume, and the token endpoint for authorization_code (PKCE S256 checked), client_credentials and RFC 8693 token exchange
// (it adds act). state.full picks a variant: { signin: 'ok' | 'resume' | 'bad-password' | 'mfa', exchange: 'ok' | 'no-act' | 'refuse' }.
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export const ENV_ID = '11111111-2222-4333-8444-555555555555';
export const CLIENT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
export const CLIENT_SECRET = ['fake', '-client-', 'secret-', 'for-tests-', '0123456789abcdef'].join('');
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// A JWT-shaped token built here; the signature segment is filler.
export const FAKE_TOKEN = [b64u({ alg: 'RS256', typ: 'JWT', kid: 'fake-kid' }), b64u({ iss: `http://fake.invalid/${ENV_ID}/as`, aud: 'https://api.fake.invalid', client_id: CLIENT_ID, scope: 'p1:fake', exp: 4102444800 }), 'ZmFrZXNpZ25hdHVyZWZvcnRlc3Rz'].join('.');

export const USER_CLIENT_ID = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
export const USER_CLIENT_SECRET = ['fake', '-user-', 'secret-', 'for-tests-', 'fedcba9876543210'].join('');
export const AGENT_CLIENT_ID = '88888888-9999-4aaa-8bbb-cccccccccccc';
export const AGENT_CLIENT_SECRET = ['fake', '-agent-', 'secret-', 'for-tests-', '13579bdf02468ace'].join('');
export const DEMO_USERNAME = 'lab-demo-user';
export const DEMO_PASSWORD = ['Fake', 'Pass', 'word-', 'for-tests-', '42'].join('');
export const AUDIENCE = 'fake-gateway-audience';
export const SCOPE = 'fake:mcp:invoke';
export const USER_SUB = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const jwt = (claims) => [b64u({ alg: 'RS256', typ: 'JWT', kid: 'fake-kid' }), b64u({ iss: `http://fake.invalid/${ENV_ID}/as`, iat: 1700000000, exp: 4102444800, ...claims }), 'ZmFrZXNpZ25hdHVyZWZvcnRlc3Rz'].join('.');
const basicOf = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

// behaviour: 'ok' | 'bad-secret' | 'discovery-500' | 'redirect' | 'huge' | 'slow' | 'html' | 'opaque'
export async function startFakePingOne({ behaviour = 'ok', delayMs = 0 } = {}) {
  const seen = [];
  const state = { behaviour, delayMs, full: { signin: 'ok', exchange: 'ok' } };
  const flows = new Map(); // flow id -> { cookie, challenge, state, nonce, done }
  const codes = new Map(); // code -> { challenge, nonce }
  const issued = { user: new Set(), agent: new Set(), delegated: new Set() };
  const server = http.createServer((req, res) => {
    const body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(body).toString('utf8') });
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      const go = () => {
        const b = state.behaviour;
        if (b === 'redirect') return send(302, '', { location: 'http://127.0.0.1:1/never-followed' });
        if (b === 'huge') return send(200, JSON.stringify({ filler: 'x'.repeat(200 * 1024) }));
        if (b === 'html') return send(200, '<html>not json</html>', { 'content-type': 'text/html' });
        const u = new URL(req.url, 'http://fake.invalid');
        const cookieOf = () => /(?:^|;\s*)ST=([^;]+)/.exec(String(req.headers.cookie || ''))?.[1] ?? null;
        if (req.method === 'GET' && u.pathname === `/${ENV_ID}/as/authorize`) {
          const q = Object.fromEntries(u.searchParams);
          if (q.response_mode !== 'pi.flow') return send(400, { error: 'unsupported_response_mode', error_description: 'fake: only pi.flow (no redirect login)' });
          if (q.client_id !== USER_CLIENT_ID || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge || !q.redirect_uri || !String(q.scope || '').split(' ').includes('openid') || !String(q.scope || '').split(' ').includes(SCOPE)) return send(400, { error: 'invalid_request', error_description: 'fake: authorize needs the user client, code, PKCE S256, a redirect_uri and the openid and gateway scopes' });
          const id = randomBytes(8).toString('hex'); const st = randomBytes(12).toString('hex');
          flows.set(id, { cookie: st, challenge: q.code_challenge, state: q.state, nonce: q.nonce, done: false });
          return send(200, { id, status: 'USERNAME_PASSWORD_REQUIRED', _links: { 'usernamePassword.check': { href: `http://fake.invalid/${ENV_ID}/flows/${id}` } } }, { 'set-cookie': [`ST=${st}; Path=/; HttpOnly`, 'interactionId=fake-interaction; Path=/'] });
        }
        const fm = /^\/[^/]+\/flows\/([a-z0-9]+)$/.exec(u.pathname);
        if (req.method === 'POST' && fm) {
          const f = flows.get(fm[1]);
          if (!f || cookieOf() !== f.cookie) return send(401, { code: 'UNAUTHORIZED', message: 'fake: the flow cookie is missing' });
          if (req.headers['content-type'] !== 'application/vnd.pingidentity.usernamePassword.check+json') return send(415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'fake: use the vendor content type' });
          let b = {}; try { b = JSON.parse(Buffer.concat(body).toString('utf8')); } catch { /* bad */ }
          if (state.full.signin === 'bad-password' || b.username !== DEMO_USERNAME || b.password !== DEMO_PASSWORD) return send(400, { code: 'INVALID_DATA', message: 'fake: the request could not be completed', details: [{ code: 'INVALID_VALUE', target: 'password', message: 'Invalid username or password' }] });
          if (state.full.signin === 'mfa') return send(200, { id: fm[1], status: 'MFA_REQUIRED' });
          f.done = true;
          const code = randomBytes(16).toString('hex'); codes.set(code, { challenge: f.challenge, nonce: f.nonce });
          if (state.full.signin === 'resume') { f.code = code; return send(200, { id: fm[1], status: 'COMPLETED', _links: { resume: { href: 'x' } } }); }
          return send(200, { id: fm[1], status: 'COMPLETED', authorizeResponse: { code, state: f.state } });
        }
        if (req.method === 'GET' && u.pathname === `/${ENV_ID}/as/resume`) {
          const f = flows.get(u.searchParams.get('flowId'));
          if (!f || !f.done || !f.code || cookieOf() !== f.cookie) return send(400, { code: 'INVALID_REQUEST', message: 'fake: no completed flow' });
          return send(200, { authorizeResponse: { code: f.code, state: f.state } });
        }
        if (req.method === 'POST' && u.pathname === `/${ENV_ID}/as/token` && req.headers.authorization !== `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`) {
          const form = Object.fromEntries(new URLSearchParams(Buffer.concat(body).toString('utf8')));
          const auth = req.headers.authorization;
          if (form.grant_type === 'authorization_code') {
            if (auth !== basicOf(USER_CLIENT_ID, USER_CLIENT_SECRET)) return send(401, { error: 'invalid_client', error_description: 'fake: user client' });
            const c = codes.get(form.code); codes.delete(form.code);
            if (!c || createHash('sha256').update(String(form.code_verifier || '')).digest('base64url') !== c.challenge) return send(400, { error: 'invalid_grant', error_description: 'fake: bad code or PKCE verifier' });
            const at = jwt({ sub: USER_SUB, aud: 'fake-user-api', client_id: USER_CLIENT_ID, scope: 'openid profile' }); issued.user.add(at);
            return send(200, { access_token: at, id_token: jwt({ sub: USER_SUB, aud: USER_CLIENT_ID, nonce: c.nonce, preferred_username: DEMO_USERNAME }), refresh_token: 'fake-refresh-never-shown-0123456789', token_type: 'Bearer', expires_in: 3600, scope: 'openid profile' });
          }
          if (form.grant_type === 'client_credentials') {
            if (auth !== basicOf(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET)) return send(401, { error: 'invalid_client', error_description: 'fake: agent client' });
            const at = jwt({ sub: AGENT_CLIENT_ID, client_id: AGENT_CLIENT_ID, aud: 'fake-agent-api' }); issued.agent.add(at);
            return send(200, { access_token: at, token_type: 'Bearer', expires_in: 3600 });
          }
          if (form.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange') {
            if (auth !== basicOf(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET)) return send(401, { error: 'invalid_client', error_description: 'fake: agent client' });
            if (state.full.exchange === 'refuse') return send(400, { error: 'invalid_request', error_description: 'fake: exchange refused' });
            if (!issued.user.has(form.subject_token) || !issued.agent.has(form.actor_token) || form.audience !== AUDIENCE || form.scope !== SCOPE) return send(400, { error: 'invalid_grant', error_description: 'fake: subject, actor, audience or scope is wrong' });
            const at = jwt({ sub: USER_SUB, aud: AUDIENCE, scope: SCOPE, client_id: AGENT_CLIENT_ID, ...(state.full.exchange === 'no-act' ? {} : { act: { sub: AGENT_CLIENT_ID } }) }); issued.delegated.add(at);
            return send(200, { access_token: at, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 900, scope: SCOPE });
          }
          return send(400, { error: 'unsupported_grant_type' });
        }
        if (req.method === 'GET' && req.url === `/${ENV_ID}/as/.well-known/openid-configuration`) {
          if (b === 'discovery-500') return send(500, { code: 'UNEXPECTED_ERROR', message: 'fake failure' });
          return send(200, { issuer: `http://fake.invalid/${ENV_ID}/as`, token_endpoint: `http://fake.invalid/${ENV_ID}/as/token`, grant_types_supported: ['client_credentials', 'authorization_code', 'urn:ietf:params:oauth:grant-type:token-exchange'], token_endpoint_auth_methods_supported: ['client_secret_basic'], ignored_field: 'not shown' });
        }
        if (req.method === 'POST' && req.url === `/${ENV_ID}/as/token`) {
          const want = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
          if (b === 'bad-secret' || req.headers.authorization !== want) return send(401, { error: 'invalid_client', error_description: 'fake: the client credentials are not valid' });
          return send(200, { access_token: b === 'opaque' ? 'opaque-token-value-0123456789abcdef' : FAKE_TOKEN, token_type: 'Bearer', expires_in: 3600, scope: 'p1:fake', id_token_hint: 'dropped' });
        }
        return send(404, { error: 'not_found' });
      };
      if (state.delayMs) setTimeout(go, state.delayMs); else go();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { seen, state, issued, port, base: `http://127.0.0.1:${port}/${ENV_ID}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

export const settingsFor = () => ({ PINGONE_ENVIRONMENT_ID: ENV_ID, PINGONE_REGION: 'com', PINGONE_CLIENT_ID: CLIENT_ID, PINGONE_CLIENT_SECRET: CLIENT_SECRET });

// Full Real settings for the fakes (fake values only). gatewayUrl: the fake gateway's URL (loopback http).
export const fullSettingsFor = (gatewayUrl) => ({
  PINGONE_ENVIRONMENT_ID: ENV_ID, PINGONE_REGION: 'com', CAL_USER_CLIENT_ID: USER_CLIENT_ID, CAL_USER_CLIENT_SECRET: USER_CLIENT_SECRET, CAL_AGENT_CLIENT_ID: AGENT_CLIENT_ID,
  CAL_AGENT_CLIENT_SECRET: AGENT_CLIENT_SECRET, CAL_DEMO_USERNAME: DEMO_USERNAME, CAL_AGENT_GATEWAY_URL: gatewayUrl, CAL_GATEWAY_AUDIENCE: AUDIENCE, CAL_GATEWAY_SCOPE: SCOPE,
});
