import http from 'node:http';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createWorkspaces } from '../src/workspaces.js';
import { VERTICALS } from '../src/cast.js';

export const C = VERTICALS.banking;
export const MOCK_OK = { ALLOW_MOCK_SIGNIN: '1' };

// A real Express app on an ephemeral loopback port. webDist defaults to a folder that does not exist, so these tests do not depend on whether `npm run build` has run. env is the app's injected environment (the guards read it), bind is the host the server claims.
export async function withServer(fn, { configFile = '/nonexistent/customer.config.json', workspaces = createWorkspaces(), env = MOCK_OK, bind = '127.0.0.1', webDist = '/nonexistent/web-dist', live } = {}) {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile, workspaces, env, bind, webDist, ...(live ? { live } : {}) }) });
  try { await fn(url.replace(/\/$/, ''), { workspaces }); } finally { health.stop(); await new Promise((res) => server.close(res)); }
}

export const post = (url, path, body, headers = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify(body) });
export const put = (url, path, body, headers = {}) => fetch(`${url}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify(body) });
export const get = (url, path, headers = {}) => fetch(`${url}${path}`, { headers });

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
export const W = (id) => ({ 'x-workspace': id });
// One mock run over HTTP: { status, body }.
export async function run(url, id, body = {}, headers = {}) {
  const r = await post(url, `/api/run/${encodeURIComponent(id)}`, body, headers);
  return { status: r.status, body: await r.json() };
}
