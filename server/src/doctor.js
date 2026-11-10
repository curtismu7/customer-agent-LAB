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
import { deployModeFrom, modeFrom } from './config.js';
import { MANIFEST, TRACKS } from './manifest.js';
import { KNOWN_STEPS, chainOf, runUseCase } from './flow.js';
import { signMockJwt, verifyMockJwt } from './mockjwt.js';
import { APP_ENV_FILE, fullWanted, liveSettingsFor, missingFull, settingsPath } from './settings.js';
import { realConfig } from './real.js';
import { liveConfig } from './live.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export const settingsFile = (env = process.env) => settingsPath(env);

export async function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);
  try { add('deploy', 'pass', deployModeFrom(env) === 'hosted' ? 'hosted build (CAL_DEPLOY_MODE=hosted): mock only; live, the llama.cpp brain and the settings file are refused or ignored' : 'local (a clone or local Docker)'); }
  catch (e) { add('deploy', 'fail', e.message); }
  try { add('mode', 'pass', `${modeFrom(env)} is the opening mode (mock is the default). Opening in live does not check or switch on the live guard: selecting Real and every live run still need the PingOne settings and the guards (no CAL_ALLOW_LIVE=0, IDP unset or pingone, loopback, no proxy)`); }
  catch (e) { add('mode', 'fail', e.message); }
  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.CALAB_BIND ? ' (CALAB_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);
  const file = settingsFile(env);
  // Says which file it reads and lists the missing Live settings by NAME; a value is never printed.
  const which = `reads ${file}${file === APP_ENV_FILE ? " (this app's .env beside docker-compose.yml)" : ' (CAL_ENV_FILE)'}`;
  let stat = null;
  try { stat = fs.statSync(file); } catch { /* absent */ }
  if (env.CAL_LIVE_FROM_ENV === '1') {
    const missing = missingFull(liveSettingsFor(env));
    add('settings-file', 'pass', `Docker: docker-compose.yml passed the Real settings from the app's .env beside it; ${missing.length ? `full-Real settings missing: ${missing.join(', ')}` : 'the full-Real settings are all set'} (values are never printed)`);
  } else if (!stat || !stat.isFile()) add('settings-file', 'info', `${which}: not there. Mock needs none; for Real copy .env.example to .env (chmod 600) and fill its full-Real settings (PINGONE_ENVIRONMENT_ID and the CAL_* names)`);
  else {
    const open = stat.mode & 0o077;
    const missing = missingFull(liveSettingsFor(env));
    const liveText = missing.length ? `full-Real settings missing: ${missing.join(', ')}` : 'the full-Real settings are all set';
    add('settings-file', open ? 'info' : 'pass', `${which}: ${open ? 'readable by others, chmod 600 it' : 'mode 600'}; ${liveText} (values are never printed)`);
  }
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
  // Option (a), owner 2026-11-10: Real is available whenever the PingOne settings are complete; CAL_ALLOW_LIVE=0 is the explicit OFF switch.
  // Full Real (owner, 2026-11-10): any CAL_* setting makes it the target and the old worker-client path is ignored; the missing ones are named.
  const settings = liveSettingsFor(env);
  const wanted = fullWanted(settings);
  const full = realConfig(settings, env);
  const cfg = wanted ? { problem: 'ignored: the full-Real settings are being used' } : liveConfig(settings, env);
  const refused = liveRefusal({ env, bind: bindHost(env), headers: {} });
  let liveOn = false;
  if (env.CAL_ALLOW_LIVE === '0') add('live', 'pass', 'Real is switched off (CAL_ALLOW_LIVE=0): this lab reaches no network');
  else if (wanted && full.problem) add('live', 'info', `full Real is not configured yet: ${missingFull(settings).length ? `missing ${missingFull(settings).join(', ')}` : full.problem}. Mock only, this lab reaches no network (the old PINGONE_CLIENT_* path is ignored)`);
  else if (wanted && refused) add('live', 'info', `full Real is configured but refused: ${refused}`);
  else if (wanted) { liveOn = true; add('live', 'pass', `full Real is on: sign-in (pi.flow), agent token and token exchange at ${new URL(full.base).origin}, MCP to ${new URL(full.gatewayUrl).origin}; the netguard allows those two hosts`); }
  else if (cfg.problem) add('live', 'pass', `Real is not configured (full Real needs ${missingFull(settings).join(', ')}): Mock only, this lab reaches no network`);
  else if (refused) add('live', 'info', `Real (identity provider only) is configured but refused: ${refused}`);
  else { liveOn = true; add('live', 'pass', `Real, identity provider only (the old worker client, until the full-Real settings exist; still missing ${missingFull(settings).join(', ')}): two calls, only to ${new URL(cfg.base).origin}; the netguard allows that one host`); }
  add('tenant', 'pass', liveOn ? 'mock runs touch no tenant and no network; a Real run reaches only the hosts named above' : 'simulated only: no tenant, no credentials, no outbound network');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
