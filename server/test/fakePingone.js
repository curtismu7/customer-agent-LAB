// A fake PingOne on a loopback port, for the live-mode tests and the e2e. It is not PingOne: it answers the two paths live mode calls and records what it
// was sent. The client id and secret are assembled at run time, so no credential-shaped string sits in the repository.
import http from 'node:http';

export const ENV_ID = '11111111-2222-4333-8444-555555555555';
export const CLIENT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
export const CLIENT_SECRET = ['fake', '-client-', 'secret-', 'for-tests-', '0123456789abcdef'].join('');
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// A JWT-shaped token built here; the signature segment is filler.
export const FAKE_TOKEN = [b64u({ alg: 'RS256', typ: 'JWT', kid: 'fake-kid' }), b64u({ iss: `http://fake.invalid/${ENV_ID}/as`, aud: 'https://api.fake.invalid', client_id: CLIENT_ID, scope: 'p1:fake', exp: 4102444800 }), 'ZmFrZXNpZ25hdHVyZWZvcnRlc3Rz'].join('.');

// behaviour: 'ok' | 'bad-secret' | 'discovery-500' | 'redirect' | 'huge' | 'slow' | 'html' | 'opaque'
export async function startFakePingOne({ behaviour = 'ok', delayMs = 0 } = {}) {
  const seen = [];
  const state = { behaviour, delayMs };
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
  return { seen, state, port, base: `http://127.0.0.1:${port}/${ENV_ID}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

export const settingsFor = () => ({ PINGONE_ENVIRONMENT_ID: ENV_ID, PINGONE_REGION: 'com', PINGONE_CLIENT_ID: CLIENT_ID, PINGONE_CLIENT_SECRET: CLIENT_SECRET });
