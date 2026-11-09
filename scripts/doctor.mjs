// Preflight: the same checks GET /api/health reports from, plus whether the port is free, plus one real run through the HTTP API on a throwaway port
// (a mock run that is permitted, one that is denied, and a Reset). Prints only pass/fail lines, never a setting's value. Exit 1 on failure.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(root, p)));
const { installNetguard } = await load('server/src/netguard.js');
installNetguard();
const { applySharedSettings } = await load('server/src/settings.js');
applySharedSettings();

const { runChecks } = await load('server/src/doctor.js');
let failed = 0;
const report = (level, name, detail) => { if (level === 'fail') failed++; console.log(`${level.toUpperCase().padEnd(4)}  ${name}: ${detail}`); };
for (const c of await runChecks()) report(c.level, c.id, c.detail);

// A real cycle through the HTTP layer, in this process, on an ephemeral loopback port. The doctor opts in to mock sign-in for ITS OWN throwaway app only.
try {
  const { createApp, startHttpServer } = await load('server/src/app.js');
  const { createHealth } = await load('server/src/health.js');
  const { createWorkspaces } = await load('server/src/workspaces.js');
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  const app = createApp({ health, env: { ALLOW_MOCK_SIGNIN: '1' }, bind: '127.0.0.1', workspaces: createWorkspaces() });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app });
  try {
    const base = url.replace(/\/$/, ''); const h = { 'content-type': 'application/json', origin: base, 'x-workspace': 'doctor' };
    const post = async (p, b = {}) => { const r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
    const ok = await post('/api/run/UC1', { vertical: 'banking' });
    const denied = await post('/api/run/UC6', { vertical: 'healthcare' });
    const reset = await post('/api/reset');
    const good = ok.body.run?.outcome === 'PERMIT' && denied.body.run?.outcome === 'DENY' && reset.body.reset === 'ok' && ok.body.run.hops.filter((x) => x.verdict !== 'skip').every((x) => /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(x.traceparent));
    report(good ? 'pass' : 'fail', 'http-cycle', good ? 'a permitted run, a denied run and a Reset behaved over the HTTP API, every hop that ran carrying a traceparent' : 'the run, deny, reset cycle did not complete');
  } finally { health.stop(); await new Promise((res) => server.close(res)); }
} catch { report('fail', 'http-cycle', 'the HTTP cycle could not run'); }

const port = Number(process.env.PORT) || 5600;
await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => { report('fail', 'port-free', `${port} is not free (${e.code}). Set PORT to a free port in 5600-5699`); resolve(); });
  s.listen(port, '127.0.0.1', () => s.close(() => { report('pass', 'port-free', `${port} is free`); resolve(); }));
});
process.exit(failed ? 1 : 0);
