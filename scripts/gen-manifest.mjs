#!/usr/bin/env node
// One-off generator: reads the AI-DEMO2 use-case catalog (READ ONLY, never imported by the app) and writes data/usecases.json.
//   node scripts/gen-manifest.mjs --source <path to useCases.js> [--out data/usecases.json] [--check]
//   CAL_SOURCE_USECASES=<path> node scripts/gen-manifest.mjs
// The output is committed. The app reads only the JSON; it never loads the source file. The source path is recorded repo-relative,
// with the git commit that last touched the file and the SHA-256 of the file's text (the commit can change when the source repo's history is rewritten; the hash only changes when the text does). Output is deterministic (no timestamps).
//
// Only these fields are copied from each source entry: id, track, title, buyerStory, pingOneSolution, trigger, expectedOutcome, evidence,
// maturity, productRoles, primaryTool. Everything else in the source (codeRefs, owasp, whatToSay, match, per-vertical overrides, long text) is dropped.
// Lab-added fields (labelled in meta.labels): needs (lab-derived), flag (lab-derived from maturity), opens (lab-invented), linkOut (lab reading).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'data', 'usecases.json');

export const TRACKS = { foundations: 15, learn: 23, controls: 16, hitl: 4, demo: 8, attacks: 11, tools: 8, nhi: 2 };
export const NEEDS = ['idp', 'gw', 'authz', 'mfa', 'llm', 'privilege', 'bff', 'a2a'];
export const OPENS = ['none', 'consent', 'approval', 'a2a', 'group-board', 'obo', 'learning-link'];

// Text that names a real company or case is replaced (recorded in meta.redactions). The list is short on purpose.
const REDACTIONS = [[/Air Canada/g, 'airline chatbot-liability']];

// lab reading: a learn-track entry points at a sibling standalone only where that sibling's README describes the same thing. Three weaker matches were
// removed after review (UC-LEARN4 an MCP education panel, UC-PAM-SETUP and UC-PAM-SCRIPT PingOne Privilege setup and AWS access): the siblings that were
// pointed at (an MCP inspector and scanner, a Cedar-based PEP demo) do not cover those topics.
export const LINK_OUT = {
  'UC-LEARN2': 'pingone-mcp-inspector',
  'UC-LEARN3': 'mcp-tools',
  'UC-LEARN5': 'learning-hub',
  'UC-LEARN9': 'id-jag-standalone',
  'UC-LEARN19': 'intent-par-inspector',
  'UC14b': 'intent-par-inspector',
};

const FIELDS = ['id', 'track', 'title', 'buyerStory', 'pingOneSolution', 'trigger', 'expectedOutcome', 'evidence', 'maturity', 'productRoles', 'primaryTool'];

function redact(value, counter) {
  if (typeof value === 'string') {
    let out = value;
    for (const [re, to] of REDACTIONS) out = out.replace(re, () => { counter.n += 1; return to; });
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, counter));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, counter)]));
  return value;
}

const chainOf = (uc) => uc.evidence?.tokenChain || [];
const textOf = (uc) => `${uc.title} ${uc.buyerStory} ${uc.pingOneSolution}`;

export function deriveNeeds(uc) {
  const set = new Set(Object.keys(uc.productRoles || {}).filter((k) => NEEDS.includes(k)));
  if (chainOf(uc).some((s) => s.startsWith('a2a-')) || /\bA2A\b/.test(uc.title)) set.add('a2a');
  if (['STEP_UP', 'HITL_REQUIRED'].includes(uc.expectedOutcome)) set.add('mfa');
  if (uc.maturity === 'flag:ciba_enabled') set.add('mfa');
  return NEEDS.filter((n) => set.has(n));
}

export function deriveOpens(uc) {
  const chain = chainOf(uc);
  const t = textOf(uc);
  if (['STEP_UP', 'HITL_REQUIRED'].includes(uc.expectedOutcome) || /HITL|CIBA|approval/i.test(uc.title) || chain.includes('ciba-poll') || chain.includes('hitl-receipt')) return 'approval';
  if (chain.includes('token-exchange') && /consent/i.test(t)) return 'consent';
  if (chain.some((s) => s.startsWith('a2a-')) || /\bA2A\b/.test(uc.title)) return 'a2a';
  if (/group/i.test(uc.title)) return 'group-board';
  if (/on-behalf-of|\bOBO\b/i.test(uc.title)) return 'obo';
  if (uc.track === 'learn') return 'learning-link';
  return 'none';
}

export function buildManifest(rawUseCases, source) {
  const counter = { n: 0 };
  const usecases = rawUseCases.map((raw) => {
    const picked = Object.fromEntries(FIELDS.map((f) => [f, raw[f] === undefined ? null : raw[f]]));
    const uc = redact(picked, counter);
    uc.primaryTool = uc.primaryTool || null;
    uc.productRoles = uc.productRoles || {};
    return {
      ...uc,
      needs: deriveNeeds(uc),
      flag: typeof uc.maturity === 'string' && uc.maturity.startsWith('flag:') ? uc.maturity.slice(5) : null,
      opens: deriveOpens(uc),
      linkOut: Object.hasOwn(LINK_OUT, uc.id) ? LINK_OUT[uc.id] : null,
    };
  });
  return {
    schema: 'customer-agent-usecases/1',
    source,
    meta: {
      counts: Object.fromEntries(Object.keys(TRACKS).map((t) => [t, usecases.filter((u) => u.track === t).length])),
      total: usecases.length,
      copiedFields: FIELDS,
      labels: {
        needs: 'lab-derived: from productRoles, the token chain, the outcome and the maturity flag',
        flag: 'lab-derived: the feature flag named in maturity, if any',
        opens: 'lab-invented: which extra panel the use case needs (first match of approval, consent, a2a, group-board, obo, learning-link)',
        linkOut: 'lab reading: the sibling standalone whose README describes the same thing; null where none was matched (learn track only)',
      },
      redactions: counter.n,
      omitted: 'codeRefs, owasp, whatToSay, match, whatLong, businessValue, advanced, useCaseId and every per-vertical override are not copied.  One customer-flavoured vertical name in the source list is left out of the vertical list.',
    },
    usecases,
  };
}

function git(cwd, args) { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim(); }

export function readSource(file) {
  const abs = path.resolve(file);
  const top = git(path.dirname(abs), ['rev-parse', '--show-toplevel']);
  const rel = path.relative(top, abs);
  const source = {
    repo: path.basename(top),
    file: rel,
    commit: git(top, ['log', '-1', '--format=%H', '--', rel]),
    contentSha256: createHash('sha256').update(fs.readFileSync(abs)).digest('hex'),
    modifiedSinceCommit: git(top, ['status', '--porcelain', '--', rel]) !== '',
    note: 'read only; loaded once by this generator, never imported by the app',
  };
  const mod = createRequire(import.meta.url)(abs);
  return { raw: mod.RAW_USE_CASES, verticals: mod.VERTICALS, source };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const src = flag('source') || process.env.CAL_SOURCE_USECASES;
  if (!src) { console.error('usage: node scripts/gen-manifest.mjs --source <path to useCases.js> [--out file] [--check]'); process.exit(2); }
  const { raw, source } = readSource(src);
  const manifest = buildManifest(raw, source);
  const bad = Object.entries(TRACKS).filter(([t, n]) => manifest.meta.counts[t] !== n);
  if (manifest.meta.total !== 87 || bad.length) { console.error(`source does not have the expected 87 use cases / track counts (${manifest.meta.total}; wrong: ${bad.map((b) => b[0]).join(',')})`); process.exit(1); }
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const out = flag('out') || OUT;
  if (argv.includes('--check')) {
    // The recorded commit may differ when the source repo's history was rewritten; the content hash and the use cases are what must match.
    const strip = (t) => { const j = JSON.parse(t); delete j.source.commit; return JSON.stringify(j); };
    const same = fs.existsSync(out) && strip(fs.readFileSync(out, 'utf8')) === strip(text);
    console.log(same ? 'manifest matches the source (same file text, same use cases)' : 'manifest differs from the source');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(out, text);
  console.log(`wrote ${path.relative(ROOT, out)}: ${manifest.meta.total} use cases (${Object.entries(manifest.meta.counts).map(([t, n]) => `${t} ${n}`).join(', ')}), source commit ${source.commit.slice(0, 9)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
