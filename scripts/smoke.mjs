#!/usr/bin/env node
// The minimum end-to-end check against a RUNNING lab: health, the use-case list (87), one permitted mock run, Reset.
//   node scripts/smoke.mjs [base-url]      (default http://localhost:${PORT:-5600}; loopback only)
// The run needs the lab to have been started with ALLOW_MOCK_SIGNIN=1 (scripts/run.sh and Docker do that).
import { pathToFileURL } from 'node:url';
import { isLoopbackHost } from '../server/src/safety.js';

export async function smoke(base = `http://localhost:${process.env.PORT || 5600}`) {
  const u = new URL(base);
  if (!isLoopbackHost(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  const h = { 'content-type': 'application/json', origin: u.origin, 'x-workspace': 'smoke' };
  const get = async (p) => (await fetch(new URL(p, u))).json();
  const post = async (p, b = {}) => { const r = await fetch(new URL(p, u), { method: 'POST', headers: h, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  const results = [];
  const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
  const health = await get('/api/health');
  check('health is demo-health/1 and ready', health.schema === 'demo-health/1' && health.state === 'ready');
  const list = await get('/api/usecases');
  check('87 use cases in 8 tracks', list.total === 87 && list.tracks.length === 8);
  const run = await post('/api/run/UC1', { vertical: 'banking' });
  check('UC1 runs in mock and is permitted', run.status === 200 && run.body.run?.outcome === 'PERMIT' && run.body.run.matchesExpected === true);
  const reset = await post('/api/reset');
  check('reset', reset.status === 200 && reset.body.reset === 'ok');
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smoke(process.argv[2]).then((rs) => { for (const r of rs) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`); process.exit(rs.every((r) => r.ok) ? 0 : 1); }, (e) => { console.error(e.message); process.exit(1); });
}
