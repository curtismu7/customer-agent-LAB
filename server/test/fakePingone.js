// A fake PingOne on a loopback port, for the live-mode tests and the e2e. It is not PingOne: it answers the paths live mode and full Real call and records
// what it was sent. The client ids and secrets and the demo password are assembled at run time, so no credential-shaped string sits in the repository.
// Full Real (owner, 2026-11-10): authorize with response_mode=pi.flow (anything else is refused: there is no redirect login), the flows API
// username/password step, resume, and the token endpoint for authorization_code (PKCE S256 checked), client_credentials and RFC 8693 token exchange.
// It models the two PingOne resources the two-exchange pattern needs (state.resources), as the real setup has them:
//   agent   owns the agent scope; its act attribute reads the ACTOR token's client_id into act.sub (act: 'actor'), or is missing (act: 'absent').
//   gateway owns the gateway scope and chooses the audience; its act attribute passes the SUBJECT token's act through (act: 'passthrough'), or is missing.
// So exchange 1 (user + agent actor, agent scope) mints act, exchange 2 (the exchange-1 token, gateway scope) keeps it, and the OLD single exchange (the
// user's token + the agent actor + the gateway scope) or an exchange 2 on a plain user token mints NO act: the bug this fake lets the tests pin.
// (act: 'empty' mints a useless act: {} with no sub; 'blank' an act with an empty sub.)
// state.full picks a variant: { signin: 'ok' | 'resume' | 'bad-password' | 'mfa' | 'echo-pw' | 'bad-state' | 'no-state',
//   exchange: 'ok' | 'refuse' (the exchange for the agent scope) | 'refuse-2' (the exchange for the gateway scope) | 'echo' / 'echo-2' (the same refusals, but
//   PingOne's error text echoes the subject token and the agent's client secret, as a careless authorization server might) }.
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
export const AGENT_SCOPE = 'agent:invoke';
export const AGENT_AUDIENCE = 'fake-agent-audience';
export const USER_SUB = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const jwt = (claims) => [b64u({ alg: 'RS256', typ: 'JWT', kid: 'fake-kid' }), b64u({ iss: `http://fake.invalid/${ENV_ID}/as`, iat: 1700000000, exp: 4102444800, ...claims }), 'ZmFrZXNpZ25hdHVyZWZvcnRlc3Rz'].join('.');
const basicOf = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
const claimsIn = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return null; } };
const AT_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

// behaviour: 'ok' | 'bad-secret' | 'discovery-500' | 'redirect' | 'huge' | 'slow' | 'html' | 'opaque'
export async function startFakePingOne({ behaviour = 'ok', delayMs = 0, agentScope = AGENT_SCOPE } = {}) {
  const seen = [];
  const resources = {
    agent: { name: 'Fake agent resource', audience: AGENT_AUDIENCE, scopes: [agentScope], act: 'actor' },
    gateway: { name: 'Fake gateway resource', audience: AUDIENCE, scopes: [SCOPE], act: 'passthrough' },
  };
  // agentGrants: the scopes the agent app may ask for (the owner setup script grants both).
  const state = { behaviour, delayMs, full: { signin: 'ok', exchange: 'ok' }, resources, agentGrants: [agentScope, SCOPE] };
  const flows = new Map(); // flow id -> { cookie, challenge, state, nonce, done }
  const codes = new Map(); // code -> { challenge, nonce }
  // exchange1: tokens minted for the agent scope's resource. delegated: tokens for the gateway scope's resource that carry act (what the gateway and
  // Authorize accept). noAct: gateway-resource tokens WITHOUT act (the old single-exchange bug): the fake gateway refuses these.
  const issued = { user: new Set(), agent: new Set(), exchange1: new Set(), delegated: new Set(), noAct: new Set() };
  const resourceOf = (scope) => { const asked = String(scope || '').split(' ').filter(Boolean); return asked.length && asked.every((sc) => Object.values(resources).some((r) => r.scopes.includes(sc))) ? Object.values(resources).find((r) => r.scopes.includes(asked[0])) : null; };
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
          if (state.full.signin === 'echo-pw') return send(400, { code: 'INVALID_DATA', message: `fake echo: ${b.password}`, details: [{ code: 'INVALID_VALUE', message: `bad ${b.password}` }] });
          if (state.full.signin === 'bad-password' || b.username !== DEMO_USERNAME || b.password !== DEMO_PASSWORD) return send(400, { code: 'INVALID_DATA', message: 'fake: the request could not be completed', details: [{ code: 'INVALID_VALUE', target: 'password', message: 'Invalid username or password' }] });
          if (state.full.signin === 'mfa') return send(200, { id: fm[1], status: 'MFA_REQUIRED' });
          f.done = true;
          const code = randomBytes(16).toString('hex'); codes.set(code, { challenge: f.challenge, nonce: f.nonce });
          if (state.full.signin === 'resume') { f.code = code; return send(200, { id: fm[1], status: 'COMPLETED', _links: { resume: { href: 'x' } } }); }
          if (state.full.signin === 'bad-state') return send(200, { id: fm[1], status: 'COMPLETED', authorizeResponse: { code, state: 'not-the-state' } });
          if (state.full.signin === 'no-state') return send(200, { id: fm[1], status: 'COMPLETED', authorizeResponse: { code } });
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
            const asked = String(form.scope || '').split(' ').filter(Boolean);
            if (asked.some((sc) => !state.agentGrants.includes(sc))) return send(400, { error: 'invalid_scope', error_description: 'fake: the agent app has no grant for that scope' });
            const res = asked.length ? resourceOf(form.scope) : null;
            const at = jwt({ sub: AGENT_CLIENT_ID, client_id: AGENT_CLIENT_ID, aud: res ? res.audience : 'fake-agent-api', ...(asked.length ? { scope: asked.join(' ') } : {}) }); issued.agent.add(at);
            return send(200, { access_token: at, token_type: 'Bearer', expires_in: 3600, ...(asked.length ? { scope: asked.join(' ') } : {}) });
          }
          if (form.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange') {
            if (auth !== basicOf(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET)) return send(401, { error: 'invalid_client', error_description: 'fake: agent client' });
            const res = resourceOf(form.scope);
            if (!res) return send(400, { error: 'invalid_scope', error_description: 'fake: no resource owns that scope' });
            if (String(form.scope).split(' ').some((sc) => !state.agentGrants.includes(sc))) return send(400, { error: 'invalid_scope', error_description: 'fake: the agent app has no grant for that scope' });
            if ((state.full.exchange === 'refuse' && res === resources.agent) || (state.full.exchange === 'refuse-2' && res === resources.gateway)) return send(400, { error: 'invalid_request', error_description: 'fake: exchange refused' });
            if ((state.full.exchange === 'echo' && res === resources.agent) || (state.full.exchange === 'echo-2' && res === resources.gateway)) return send(400, { error: `invalid_request ${form.subject_token}`, error_description: `fake echo: ${form.subject_token} ${AGENT_CLIENT_SECRET} ${String(form.subject_token).slice(0, 40)}` });
            const subject = [...issued.user, ...issued.exchange1, ...issued.delegated, ...issued.noAct].includes(form.subject_token) ? claimsIn(form.subject_token) : null;
            if (!subject || form.subject_token_type !== AT_TYPE) return send(400, { error: 'invalid_grant', error_description: 'fake: the subject token is not one this fake issued' });
            let actor = null;
            if (form.actor_token !== undefined) {
              if (!issued.agent.has(form.actor_token) || form.actor_token_type !== AT_TYPE) return send(400, { error: 'invalid_grant', error_description: 'fake: the actor token is not an agent token this fake issued' });
              actor = claimsIn(form.actor_token);
            }
            // The resource's act attribute decides: from the actor token (agent resource) or passed through from the subject token (gateway resource).
            const act = res.act === 'empty' ? {} : res.act === 'blank' ? { sub: '' } : res.act === 'actor' ? (actor ? { sub: actor.client_id } : null) : res.act === 'passthrough' ? (subject.act ?? null) : null;
            const at = jwt({ sub: subject.sub, aud: res.audience, scope: form.scope, client_id: AGENT_CLIENT_ID, ...(act ? { act } : {}) });
            (res === resources.agent ? issued.exchange1 : act ? issued.delegated : issued.noAct).add(at);
            return send(200, { access_token: at, issued_token_type: AT_TYPE, token_type: 'Bearer', expires_in: 900, scope: form.scope });
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
export const fullSettingsFor = (gatewayUrl, extra = {}) => ({
  PINGONE_ENVIRONMENT_ID: ENV_ID, PINGONE_REGION: 'com', CAL_USER_CLIENT_ID: USER_CLIENT_ID, CAL_USER_CLIENT_SECRET: USER_CLIENT_SECRET, CAL_AGENT_CLIENT_ID: AGENT_CLIENT_ID,
  CAL_AGENT_CLIENT_SECRET: AGENT_CLIENT_SECRET, CAL_DEMO_USERNAME: DEMO_USERNAME, CAL_AGENT_GATEWAY_URL: gatewayUrl, CAL_GATEWAY_AUDIENCE: AUDIENCE, CAL_GATEWAY_SCOPE: SCOPE, ...extra,
});
