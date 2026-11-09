import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.env.example', '.gitignore', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/safety.md', 'docs/content-pack.schema.json', 'docs/shelf-entry.json', 'customer.config.example.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/smoke.mjs', 'scripts/gen-manifest.mjs', 'scripts/validate-content-pack.mjs', 'data/usecases.json', '.githooks/pre-commit']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('package.json has the standard scripts, requires Node 26 and the Dockerfile uses a Node 26 base', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['start', 'dev', 'test', 'build', 'doctor', 'reset', 'prepare', 'smoke']) assert.ok(pkg.scripts[s], s);
  assert.equal(pkg.engines.node, '>=26');
  assert.equal((read('Dockerfile').match(/^FROM node:26-alpine/gm) || []).length, 2); assert.equal((read('Dockerfile').match(/^FROM /gm) || []).length, 2, 'every stage is Node 26');
  assert.match(read('server/package.json'), /node --test test\/\*\.test\.js/, 'the server tests use a glob');
  assert.match(pkg.scripts.test, /node --test scripts\/\*\.test\.mjs/);
});

test('the shelf entry is valid and portable: relative composeFile, loopback url, health path, catalog id D24, Demo kind', () => {
  const e = JSON.parse(read('docs/shelf-entry.json')).demos[0];
  assert.equal(e.id, 'customer-agent-lab'); assert.equal(e.kind, 'Demo'); assert.equal(e.healthPath, '/api/health');
  assert.match(e.url, /^http:\/\/localhost:56\d\d$/);
  assert.equal(e.catalogId, 'D24');
  assert.equal(e.composeFile, 'customer-agent-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(e.composeFile)); assert.ok(!/\/Users\//.test(JSON.stringify(e)));
});

test('the catalog id is D24 in the shelf entry and the content pack alike', () => {
  assert.equal(JSON.parse(read('docs/shelf-entry.json')).demos[0].catalogId, JSON.parse(read('content-pack.json')).demo.catalog);
  assert.equal(JSON.parse(read('content-pack.json')).demo.catalog, 'D24');
  assert.match(read('README.md'), /^Catalog: D24$/m);
});

test('customer.config.json is git-ignored, and its example only sets the two cast values', () => {
  assert.match(read('.gitignore'), /^customer\.config\.json$/m); assert.match(read('.gitignore'), /^\.env$/m);
  assert.deepEqual(Object.keys(JSON.parse(read('customer.config.example.json')).cast).sort(), ['brand', 'host']);
});

test('no shipped text names a real customer, company or tenant', () => {
  const skip = new Set(['node_modules', 'dist', '.git', '.data', 'package-lock.json', '.env', 'customer.config.json']); // git-ignored files (local settings: the e2e screenshots are binary; .env holds this Mac's host names)
  const allowed = { 'docker-compose.yml': ['customer-agent.local.ping-devops.com'] }; // proxy-served lab host (default LAB_ALLOWED_HOSTS): no real tenant or customer
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (!/\.test\.m?js$|scripts\/gen-manifest\.mjs$/.test(p)) { // the tests and the generator's one redaction rule name the words on purpose
        let t = fs.readFileSync(p, 'utf8').toLowerCase();
        for (const h of allowed[path.relative(root, p)] || []) t = t.split(h).join('');
        for (const w of ['united airlines', 'mileageplus', 'datapower', 'optum', 'unitedhealth', 'uhg', 'member benefit', 'air canada', 'walbuy', 'ping-devops', 'cmuir']) if (t.includes(w)) hits.push(`${path.relative(root, p)}: ${w}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries the forbidden-strings and gitleaks jobs and the doctor on a port in range', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/); assert.ok(!/self-hosted/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
  assert.match(ci, /forbidden-strings:/); assert.match(ci, /gitleaks/); assert.match(ci, /PORT=5609 npm run doctor/);
  assert.match(ci, /actions\/checkout@v5/); assert.match(ci, /actions\/setup-node@v5/);
  assert.match(ci, /scripts\/validate-content-pack\.mjs/);
});

test('README follows the README standard: title ends in LAB, plain Tier, Repo and Catalog lines, the port text, the 12 sections in order', () => {
  const r = read('README.md');
  assert.match(r.split('\n')[0], /^# .* LAB$/); assert.match(r, /^Tier: Demo$/m); assert.match(r, /^Repo: https:\/\/github\.com\/curtismu7\/customer-agent-LAB$/m);
  assert.match(r, /lsof -iTCP:5600 -sTCP:LISTEN -n -P/); assert.match(r, /PORT=<other port> npm start/); assert.match(r, /Port range for this app: 5600-5699\./);
  const at = (h) => r.indexOf(`\n## ${h}`);
  const order = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do', 'Mock and live modes', 'Health, doctor and reset', 'Docker', 'Tests', 'Troubleshooting', 'Ownership', 'Not done'].map(at);
  assert.ok(order.every((i) => i > 0), order.join());
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections are in order');
  for (const w of ['lab-invented', 'lab reading', 'lab-derived', 'UNVERIFIED', 'util.parseEnv', 'ALLOW_MOCK_SIGNIN', 'step 3 of 3']) assert.ok(r.toLowerCase().includes(w.toLowerCase()), w);
  assert.ok(!/ping-devops|cmuir/i.test(r)); assert.ok(!/\bdoor\b/i.test(r));
});

test('the README has no unfilled placeholder', () => {
  assert.ok(!/PLACEHOLDER|TODO|TBD/.test(read('README.md')));
});

test('docs never use the word "door"', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'docs/talk-track.md', 'docs/safety.md']) assert.ok(!/\bdoor\b/i.test(read(f)), f);
});

test('the lab ships no k8s manifests (deferred by the owner, 2026-10-31) and no bare MODE', () => {
  assert.ok(!fs.existsSync(path.join(root, 'k8s'))); assert.ok(!fs.existsSync(path.join(root, 'deploy')));
  for (const f of fs.readdirSync(path.join(root, 'server/src'))) assert.ok(!/process\.env\.MODE\b/.test(read(`server/src/${f}`)), f);
});

test('the Dockerfile copies only what the server needs and runs as a non-root user; the data file is copied', () => {
  const d = read('Dockerfile');
  assert.match(d, /^USER node$/m); assert.match(d, /COPY data data/); assert.match(d, /COPY server\/src server\/src/); assert.match(d, /COPY server\/diagrams server\/diagrams/);
  assert.match(read('.dockerignore'), /node_modules/);
});

test('the pre-commit hook runs gitleaks on the staged files and is wired by npm prepare', () => {
  assert.match(read('.githooks/pre-commit'), /gitleaks protect --staged/);
  assert.match(JSON.parse(read('package.json')).scripts.prepare, /core\.hooksPath \.githooks/);
});

test('step 2: the web workspace is a Vite + React app with vitest, ReactFlow and no other runtime dependency', () => {
  const w = JSON.parse(read('web/package.json'));
  assert.deepEqual(Object.keys(w.dependencies).sort(), ['@xyflow/react', 'react', 'react-dom']);
  assert.equal(w.scripts.test, 'vitest run'); assert.equal(w.scripts.build, 'vite build');
  for (const f of ['index.html', 'vite.config.js', 'src/main.jsx', 'src/App.jsx', 'src/app.css', 'src/styles/standalone-ui.css']) assert.ok(fs.existsSync(path.join(root, 'web', f)), f);
  assert.match(read('web/vite.config.js'), /5602/); assert.ok(!/5173|8080/.test(read('web/vite.config.js')));
  assert.match(read('package.json'), /"e2e": "node scripts\/e2e\.mjs"/); assert.match(read('package.json'), /npm test -w web/);
});

test('step 2: the app CSS follows the CSS standard (tokens only, no theme media query, no force, no italics, only the 600 and 900 breakpoints, no purple word)', () => {
  const css = read('web/src/app.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(css), 'no colour literal');
  assert.ok(!/prefers-color-scheme/.test(css)); assert.ok(!/!important/.test(css)); assert.ok(!/font-style:\s*italic/.test(css)); assert.ok(!/purple|violet/i.test(css));
  const widths = [...css.matchAll(/\((?:max|min)-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
  assert.ok(widths.length > 0 && widths.every((n) => n === 600 || n === 900), widths.join());
  for (const sel of css.split('{').map((b) => b.split('}').pop().trim()).filter((x) => x && !x.startsWith('@') && !x.startsWith('/*'))) {
    assert.ok(!/(^|[ ,])(div|span|p|button|input|select)\./.test(sel), `element-qualified class: ${sel.slice(0, 50)}`);
    assert.ok(sel.split(',').every((one) => one.trim().split(/\s+/).length <= 3), `more than three parts: ${sel.slice(0, 60)}`);
  }
});

test('step 2: the web source has no outbound URL, no eval/Function, no raw HTML injection and no colour literal in components', () => {
  const dir = path.join(root, 'web/src');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(jsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'standalone-ui.css' && e.name !== 'testFixtures.js' && e.name !== 'testSetup.js' && f !== path.join(dir, 'evidence/fixtures.js')) files.push(f); } };
  walk(dir);
  assert.ok(files.length >= 10);
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/https?:\/\//.test(t.replace(/\/\/ .*$/gm, '')), `${path.basename(f)} names a URL`);
    assert.ok(!/dangerouslySetInnerHTML|\beval\(|new Function|\binnerHTML\b/.test(t), `${path.basename(f)} injects HTML or evaluates text`);
    assert.ok(!/['"]#[0-9a-fA-F]{3,8}['"]/.test(t), `${path.basename(f)} has a colour literal`);
    assert.ok(!/<a[ >]/.test(t), `${path.basename(f)} renders a link: link-outs are plain labels`);
  }
});

test('step 2: the Dockerfile builds the web app in its own stage and copies only web/dist into the server image', () => {
  const d = read('Dockerfile');
  assert.match(d, /FROM node:26-alpine AS web/); assert.match(d, /npm run build -w web/); assert.match(d, /COPY --from=web \/app\/web\/dist web\/dist/);
  assert.equal((d.match(/^FROM node:26-alpine/gm) || []).length, 2); assert.match(d, /^USER node$/m);
});

test('review fix: package.json counts ten verticals (three full, seven stubs), not eleven', () => {
  const d = JSON.parse(read('package.json')).description;
  assert.match(d, /ten verticals \(three full packs and seven stubs\)/); assert.ok(!/eleven/i.test(d));
});

test('review fix: the README names the UC28 title change, the guided matchesExpected null, and that a restart frees workspace slots', () => {
  const r = read('README.md');
  assert.match(r, /UC28's title/); assert.match(r, /meta\.redactions/);
  assert.match(r, /`matchesExpected: null`/);
  assert.match(r, /a restart clears them all/);
  assert.match(r, /set on 6 entries/);
});

test('review fix: the talk track says seven stub verticals', () => {
  const t = read('docs/talk-track.md');
  assert.match(t, /Seven verticals are data stubs/); assert.ok(!/Eight verticals are data stubs/.test(t));
});

test('step 3: CI has no self-skipping conformance job (it would be a green check with nothing behind it), the pack and the talk track carry live mode, and Docker stays Mock only', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.ok(!/conformance/i.test(ci) && !/SKIPPED/.test(ci)); assert.match(read('README.md'), /CI does not run conformance/);
  const pack = JSON.parse(read('content-pack.json'));
  assert.ok(pack.glossary.some((g) => g.id === 'live-mode' && /UNVERIFIED/.test(g.definition))); assert.ok(pack.cards.some((c) => c.id === 'concept-live-mode'));
  assert.match(read('docs/talk-track.md'), /## Mock and live/); assert.match(read('docs/talk-track.md'), /UNVERIFIED/);
  const compose = read('docker-compose.yml').replace(/^\s*#.*$/gm, '');
  assert.ok(!/CAL_ALLOW_LIVE|IDP:|PINGONE|STANDALONE_ENV|\.env/.test(compose), 'Docker is Mock only: no live opt-in, no settings file mounted');
  assert.match(read('docs/shelf-entry.json'), /UNVERIFIED/);
});

test('step 3: the README says how step 3 was read, that live is identity-provider only (VERIFIED on a real PingOne environment 2026-11-05), and what is not done', () => {
  const r = read('README.md');
  for (const w of ['smallest complete reading', 'identity provider only', 'VERIFIED against a real PingOne environment by the owner on 2026-11-05', 'two real calls', 'Docker is Mock only', 'never copied into the process environment', 'LIVE_REFUSED', 'live_not_configured']) assert.ok(r.includes(w), w);
  assert.ok(!/live mode is not built|not built yet \(step 3\)|step 3 is not started/i.test(r));
});
