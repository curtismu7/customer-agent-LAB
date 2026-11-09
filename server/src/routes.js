// Where each use case runs (data/handoff.json, the owner's routing table converted once) and what to type per vertical (data/prompts.json).
// Both are committed data, validated on load: every catalog id has exactly one route, every Hand off row names an app, every prompt names a
// use case that runs here. Ids from the visitor are looked up with Object.hasOwn, never used as keys blindly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST, findUseCase } from './manifest.js';
import { isFullVertical } from './cast.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
export const ROUTE_KINDS = ['Here', 'Here + go deeper', 'Hand off', 'Guide'];
const APP_ID = /^[a-z0-9-]{2,40}$/;

export function validateRoutes(h) {
  const problems = [];
  if (h?.schema !== 'customer-agent-handoff/1') problems.push('schema');
  const routes = h?.routes && typeof h.routes === 'object' ? h.routes : {};
  const ids = MANIFEST.usecases.map((u) => u.id);
  for (const id of ids) if (!Object.hasOwn(routes, id)) problems.push(`${id}: no route`);
  for (const [id, r] of Object.entries(routes)) {
    if (!ids.includes(id)) problems.push(`${id}: not in the catalog`);
    if (!ROUTE_KINDS.includes(r?.route)) problems.push(`${id}: route out of range`);
    if (r?.app !== null && !(typeof r?.app === 'string' && APP_ID.test(r.app))) problems.push(`${id}: app is not an id`);
    if ((r?.route === 'Hand off' || r?.route === 'Here + go deeper') && !r?.app) problems.push(`${id}: ${r?.route} needs an app`);
    if ((r?.route === 'Here' || r?.route === 'Guide') && r?.app) problems.push(`${id}: ${r.route} has no app`);
  }
  return problems;
}

export function validatePrompts(p) {
  const problems = [];
  if (p?.schema !== 'customer-agent-prompts/1') problems.push('schema');
  const verticals = p?.verticals && typeof p.verticals === 'object' ? p.verticals : {};
  for (const [v, list] of Object.entries(verticals)) {
    if (!isFullVertical(v)) problems.push(`${v}: not a full vertical`);
    if (!Array.isArray(list) || !list.length) { problems.push(`${v}: no prompts`); continue; }
    const seen = new Set();
    for (const e of list) {
      if (!findUseCase(e?.uc)) problems.push(`${v}: unknown use case`);
      if (typeof e?.text !== 'string' || !e.text.trim() || e.text.length > 160) problems.push(`${v} ${e?.uc}: bad text`);
      const key = String(e?.text).trim().toLowerCase();
      if (seen.has(key)) problems.push(`${v}: duplicate prompt`);
      seen.add(key);
    }
  }
  return problems;
}

const load = (name, check) => {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
  const problems = check(data);
  if (problems.length) throw new Error(`data/${name} is not valid: ${problems.slice(0, 5).join('; ')}`);
  return data;
};
export const HANDOFF = load('handoff.json', validateRoutes);
export const PROMPTS = load('prompts.json', validatePrompts);

export const routeOf = (id) => (Object.hasOwn(HANDOFF.routes, id) ? HANDOFF.routes[id] : { route: 'Here', app: null, basis: null });

// The prompts a vertical shows under "What to type". A stub vertical has none (no demo pack yet).
export function promptsFor(vertical) {
  if (!Object.hasOwn(PROMPTS.verticals, vertical)) return [];
  return PROMPTS.verticals[vertical].map((e) => {
    const uc = findUseCase(e.uc);
    return { uc: uc.id, text: e.text, title: uc.title, track: uc.track, expectedOutcome: uc.expectedOutcome, route: routeOf(uc.id).route };
  });
}
