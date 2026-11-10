// shelf-link service: server side. Every -LAB app mounts GET /api/shelf, which returns
// the shelf (launcher) URL: SHELF_URL from the environment (Docker: env_file .env), else from
// this lab's own .env (settings.js settingsPath). No hardcoded host here (hygiene:
// repo text carries only .invalid/.example names): unconfigured means shelfUrl null and
// the web component renders nothing.
import fs from 'node:fs';
import { settingsPath } from './settings.js';

const clean = (v) => String(v).trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
function readShelfUrl(env = process.env) {
  if (env.SHELF_URL) return clean(env.SHELF_URL);
  try {
    const m = fs.readFileSync(settingsPath(env), 'utf8').split('\n').map((l) => l.match(/^SHELF_URL=(.*)$/)).find(Boolean);
    if (m) return clean(m[1]);
  } catch { /* no .env */ }
  return null;
}

export function shelfInfo(env = process.env) {
  return { shelfUrl: readShelfUrl(env) };
}

export function mountShelfRoute(router, { env = process.env } = {}) {
  router.get('/shelf', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(shelfInfo(env));
  });
}
