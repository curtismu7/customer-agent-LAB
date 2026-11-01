// The diagrams are diagram-studio/1 DATA (server/diagrams/*.json), loaded by name and checked with the studio's own validator copy.
// Nothing here builds nodes or edges by hand. Each step is one edge, walked in order by Simulate (step 2 draws them with ReactFlow).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillDeep } from './cast.js';
import { validateDiagram } from './diagramStudioValidate.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../diagrams');
export const DIAGRAM_NAMES = ['delegation-chain', 'gateway-refusals'];

export function loadDiagram(name) {
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  const problems = validateDiagram(doc);
  if (problems.length) throw new Error(`diagram ${name} is not valid diagram-studio/1: ${problems.join('; ')}`);
  return doc;
}
const DOCS = new Map(DIAGRAM_NAMES.map((n) => [n, loadDiagram(n)]));
export const rawDiagram = (name = DIAGRAM_NAMES[0]) => DOCS.get(DOCS.has(name) ? name : DIAGRAM_NAMES[0]);

// The diagram with the cast filled in. An unknown name falls back to the first diagram (it is never echoed).
export function buildDiagram(cast, name = DIAGRAM_NAMES[0]) {
  const d = fillDeep(rawDiagram(typeof name === 'string' ? name : undefined), cast);
  return {
    name: d.id, title: d.title, intro: d.lede, groups: d.groups,
    nodes: d.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.group, x: n.x, y: n.y })),
    edges: d.edges.map((e, i) => ({ n: i, source: e.source, target: e.target, label: e.label || '' })),
    steps: d.steps.map((s) => { const e = d.edges[s.edges[0]]; return { from: e.source, to: e.target, label: s.title, say: s.what, hop: s.hop, edge: s.edges[0] }; }),
  };
}
