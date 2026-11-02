// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBindAllowed, bindHost, liveRefusal, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { VERTICALS, STUB_VERTICALS, unfilled } from './cast.js';
import { buildStory, } from './story.js';
import { LABELS, EXTRA_TOKENS, rawStory } from './data.js';
import { findCredentials } from './credentials.js';
import { maskDeep, SHAPE_IDS } from './mask.js';
import { modeFrom } from './config.js';
import { MANIFEST, TRACKS } from './manifest.js';
import { KNOWN_STEPS, chainOf, runUseCase } from './flow.js';
import { signMockJwt, verifyMockJwt } from './mockjwt.js';
import { readLiveSettings, settingsPath } from './settings.js';
import { liveConfig } from './live.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export const settingsFile = (env = process.env) => (env.STANDALONE_ENV ? env.STANDALONE_ENV : settingsPath(env));

export async function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);
  try { add('mode', 'pass', `${modeFrom(env)} is the opening mode (mock is the default). Opening in live does not check or switch on the live guard: selecting Live and every live run still need the owner's opt-in (CAL_ALLOW_LIVE=1, IDP=pingone)`); }
  catch (e) { add('mode', 'fail', e.message); }
  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.CALAB_BIND ? ' (CALAB_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);
  const file = settingsFile(env);
  try { const m = fs.statSync(file).mode & 0o777; add('settings-file', m & 0o077 ? 'info' : 'pass', m & 0o077 ? 'the shared settings file is readable by others: chmod 600 it' : 'the shared settings file exists and is mode 600 (values are never printed)'); }
  catch { add('settings-file', 'info', 'no shared settings file: mock mode needs none'); }
  add('mock-signin', env.ALLOW_MOCK_SIGNIN === '1' ? 'pass' : 'info', env.ALLOW_MOCK_SIGNIN === '1' ? 'ALLOW_MOCK_SIGNIN=1: mock persona sign-in is allowed on loopback' : 'ALLOW_MOCK_SIGNIN is not 1: runs are refused until you start the lab with ALLOW_MOCK_SIGNIN=1 (scripts/run.sh and Docker set it)');

  const dist = env.WEB_DIST || WEB_DIST;
  const built = fs.existsSync(path.join(dist, 'index.html'));
  add('web', built ? 'pass' : 'info', built ? 'the web app is built (web/dist) and served at /' : 'the web app is not built: run `npm run build`, or only the API answers (the Docker image builds it)');

  const counts = Object.fromEntries(Object.keys(TRACKS).map((t) => [t, MANIFEST.usecases.filter((u) => u.track === t).length]));
  const countsOk = MANIFEST.usecases.length === 87 && Object.entries(TRACKS).every(([t, n]) => counts[t] === n);
  add('manifest', countsOk && MANIFEST.source?.commit ? 'pass' : 'fail', countsOk ? `87 use cases in 8 tracks; generated from the catalog commit ${String(MANIFEST.source.commit).slice(0, 9)}` : 'the manifest does not have 87 use cases in the expected tracks');

  const steps = new Set(MANIFEST.usecases.flatMap((u) => chainOf(u)));
  const missing = [...steps].filter((s) => !KNOWN_STEPS.includes(s));
  add('steps', missing.length ? 'fail' : 'pass', missing.length ? `evidence steps with no builder: ${missing.join(', ')}` : `${steps.size} distinct evidence steps, each has a mock builder`);

  const wrong = [];
  let flows = 0;
  for (const uc of MANIFEST.usecases) {
    const r = runUseCase(uc, { cast: VERTICALS.banking, vertical: 'banking', seed: 'doctor' });
    if (r.kind === 'flow') flows += 1;
    if (r.computed && !r.matchesExpected) wrong.push(uc.id);
  }
  add('engine', wrong.length ? 'fail' : 'pass', wrong.length ? `use cases whose computed outcome differs from the catalog: ${wrong.slice(0, 6).join(', ')}` : `all 87 run in mock and each of the ${flows} computed ones equals the catalog's outcome; the other ${87 - flows} are guided pages that show the catalog's label and are not checked`);

  const tokenText = JSON.stringify({ LABELS, story: rawStory() });
  const known = (v) => ({ ...VERTICALS[v], ...Object.fromEntries(EXTRA_TOKENS.map((t) => [t, 'x'])) });
  const badVert = Object.keys(VERTICALS).filter((v) => unfilled(tokenText, known(v)).length);
  add('verticals', badVert.length ? 'fail' : 'pass', badVert.length ? `verticals missing a token: ${badVert.join(', ')}` : `${Object.keys(VERTICALS).length} full vertical packs fill every token; ${Object.keys(STUB_VERTICALS).length} more are data stubs`);

  const filled = JSON.stringify([...Object.keys(VERTICALS).map((k) => buildStory(VERTICALS[k], k)), MANIFEST.usecases]);
  const hosts = scanHosts(filled);
  add('story-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts: ${hosts.join(', ')}` : 'every host in the story and manifest data is .invalid or .example');
  const keys = scanKeys(filled);
  // Prose heuristics (a word followed by a colon, long words) fire on ordinary product text; the credential SHAPES (tokens, keys, JWTs, key blocks) do not.
  const creds = findCredentials(filled).filter((c) => SHAPE_IDS.has(c.id));
  add('story-keys', keys.length || creds.length ? 'fail' : 'pass', keys.length || creds.length ? 'credential-shaped text in the story or manifest data' : 'no credential-shaped value in the story or manifest data');
  const story = buildStory(VERTICALS.banking, 'banking');
  const same = JSON.stringify(maskDeep([story, MANIFEST.usecases], [], true)) === JSON.stringify([story, MANIFEST.usecases]);
  add('masking', same ? 'pass' : 'fail', 'the response mask leaves the story and the 87 use cases untouched (for static text it applies the credential shapes only)');

  add('diagrams', DIAGRAM_NAMES.every((n) => Object.keys(VERTICALS).every((v) => buildDiagram(VERTICALS[v], n).steps.length > 0)) ? 'pass' : 'fail', `${DIAGRAM_NAMES.length} diagram-studio/1 diagrams load, validate and fill in every full vertical`);
  const t = signMockJwt({ sub: 'doctor' });
  add('mock-key', verifyMockJwt(t.jwt).ok && !verifyMockJwt(`${t.jwt}x`).ok ? 'pass' : 'fail', 'a MOCK token signs (ES256, key built with createECDH) and verifies; a changed one does not');

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);
  // Live (step 3) is the one thing that can leave the machine: two calls to the one configured PingOne environment. Booleans and fixed words only, never a value.
  if (env.CAL_ALLOW_LIVE !== '1') add('live', 'pass', 'live is off (CAL_ALLOW_LIVE is not 1): this lab reaches no network');
  else {
    const cfg = liveConfig(readLiveSettings(settingsFile(env)), env);
    const refused = liveRefusal({ env, bind: bindHost(env), headers: {} });
    if (cfg.problem) add('live', 'info', `live is opted in but cannot run: ${cfg.problem}`);
    else if (refused) add('live', 'info', `live is opted in but refused: ${refused}`);
    else add('live', 'pass', `live is on: a live run makes two calls, only to ${new URL(cfg.base).origin} (the configured PingOne environment); the netguard allows that one host`);
  }
  add('tenant', 'pass', env.CAL_ALLOW_LIVE === '1' ? 'mock runs touch no tenant and no network; a live run reaches the one configured PingOne environment and nothing else' : 'simulated only: no tenant, no credentials, no outbound network');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
