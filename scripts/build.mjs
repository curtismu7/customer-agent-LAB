// `npm run build`. Checks what a build must keep true (the manifest is valid: 87 use cases; the talk track and content pack are in sync with the data
// and the pack validates), then builds the web app with Vite into web/dist, which the server serves, and checks the build loads nothing from another origin.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { renderTalkTrackMarkdown } from '../server/src/story.js';
import { loadManifest } from '../server/src/manifest.js';
import { buildPack } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const m = loadManifest();
if (m.usecases.length !== 87) problems.push('manifest is not 87 use cases');
if (fs.readFileSync(path.join(ROOT, 'docs/talk-track.md'), 'utf8') !== renderTalkTrackMarkdown(DEFAULT_CAST)) problems.push('docs/talk-track.md is out of date (npm run talk-track)');
const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'content-pack.json'), 'utf8'));
if (JSON.stringify(committed) !== JSON.stringify(buildPack())) problems.push('content-pack.json is out of date (npm run content-pack)');
problems.push(...validatePack(committed));
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const web = spawnSync('npm', ['run', 'build', '-w', 'web'], { cwd: ROOT, stdio: 'inherit' });
if (web.status !== 0) { console.error('the web build failed'); process.exit(1); }
const html = fs.readFileSync(path.join(ROOT, 'web/dist/index.html'), 'utf8');
const foreign = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map((x) => x[0]);
if (foreign.length) { console.error(`web/dist/index.html loads from another origin: ${foreign.length} reference(s)`); process.exit(1); }
console.log('build ok: manifest valid (87 use cases), talk track and content pack in sync, pack validates, web built into web/dist (same-origin assets only)');
