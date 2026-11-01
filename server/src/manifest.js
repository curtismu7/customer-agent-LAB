// The use-case manifest: data/usecases.json, generated once from the AI-DEMO2 catalog by scripts/gen-manifest.mjs and committed. The app reads only this
// JSON. Validated on load: 87 use cases in eight tracks with the expected counts, unique ids, the lab-added fields in range.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TRACKS = { foundations: 15, learn: 23, controls: 16, hitl: 4, demo: 8, attacks: 11, tools: 8, nhi: 2 };
export const NEEDS = ['idp', 'gw', 'authz', 'mfa', 'llm', 'privilege', 'bff', 'a2a'];
export const OPENS = ['none', 'consent', 'approval', 'a2a', 'group-board', 'obo', 'learning-link'];
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/usecases.json');

export function validateManifest(m) {
  const problems = [];
  if (m?.schema !== 'customer-agent-usecases/1') problems.push('schema');
  const list = Array.isArray(m?.usecases) ? m.usecases : [];
  if (list.length !== 87) problems.push(`expected 87 use cases, found ${list.length}`);
  for (const [t, n] of Object.entries(TRACKS)) if (list.filter((u) => u.track === t).length !== n) problems.push(`track ${t} should have ${n}`);
  if (new Set(list.map((u) => u.id)).size !== list.length) problems.push('duplicate id');
  for (const u of list) {
    for (const f of ['id', 'track', 'title', 'buyerStory', 'pingOneSolution', 'trigger', 'expectedOutcome', 'evidence', 'maturity', 'productRoles', 'primaryTool', 'needs', 'flag', 'opens', 'linkOut']) if (!Object.hasOwn(u, f)) problems.push(`${u.id}: missing ${f}`);
    if (!Object.hasOwn(TRACKS, u.track)) problems.push(`${u.id}: unknown track`);
    if (!Array.isArray(u.needs) || !u.needs.every((n) => NEEDS.includes(n))) problems.push(`${u.id}: needs out of range`);
    if (!OPENS.includes(u.opens)) problems.push(`${u.id}: opens out of range`);
  }
  return problems;
}

export function loadManifest(file = FILE) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validateManifest(m);
  if (problems.length) throw new Error(`data/usecases.json is not valid: ${problems.slice(0, 5).join('; ')}`);
  return m;
}
export const MANIFEST = loadManifest();
const INDEX = new Map(MANIFEST.usecases.map((u) => [u.id, u]));
// A use case by id. The id comes from a URL path: a non-string or an id that is not in the manifest gives null (never echoed).
export const findUseCase = (id) => (typeof id === 'string' && INDEX.has(id) ? INDEX.get(id) : null);
