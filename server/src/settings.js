// This lab's own settings file (rulebook "Settings per app", owner 2026-11-09): `.env` beside docker-compose.yml at the repo root, resolved from this
// file's location, never from the working directory. `.env.example` lists the names. CAL_ENV_FILE points at another file (tests and the e2e use a temp
// file with fake values). The lab takes ONLY the keys listed below and ignores everything else: nothing else from the file ever enters the server's
// environment, and no value is printed. Read only; the lab never writes it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const APP_ENV_FILE = path.join(APP_ROOT, '.env');
// CAL_LAB_MODE (the opening mode), LAB_ALLOWED_HOSTS (the lab-proxy host name) and SHELF_URL (the Shelf button and the proxy's origin). None is a guard:
// CAL_ALLOW_LIVE (now only an OFF switch: 0), IDP and ALLOW_MOCK_SIGNIN stay shell settings at launch and are never read from the file.
export const SETTINGS_KEYS = ['CAL_LAB_MODE', 'LAB_ALLOWED_HOSTS', 'SHELF_URL'];
export const settingsPath = (env = process.env) => env.CAL_ENV_FILE || APP_ENV_FILE;

export function readSharedSettings(file) {
  try {
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries(SETTINGS_KEYS.filter((k) => typeof parsed[k] === 'string' && parsed[k] !== '').map((k) => [k, parsed[k]]));
  } catch { return {}; } // no file, or not readable: the defaults
}

// Fills only the listed keys, and only when the environment does not already set them.
export function applySharedSettings(env = process.env, file = settingsPath(env)) {
  for (const [k, v] of Object.entries(readSharedSettings(file))) if (env[k] === undefined) env[k] = v;
  return env;
}

// The live settings: the PingOne environment plus, for the OLD identity-provider-only path, AI-DEMO2's worker client (PINGONE_CLIENT_*), and, for FULL
// Real (owner, 2026-11-10), this lab's own user app, agent app, demo username and Agent Gateway (CAL_*). Read from the same file with util.parseEnv and
// NEVER copied into process.env (applySharedSettings above takes SETTINGS_KEYS only), so no other module, log line or child can see a secret; live.js and
// real.js hold them in closures.
export const LIVE_KEYS = ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'];
// The keys the OLD identity-provider-only Live cannot run without (PINGONE_REGION defaults to com).
export const LIVE_REQUIRED = ['PINGONE_ENVIRONMENT_ID', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'];
// Full Real (owner, 2026-11-10): the names the owner's scripts write. Any one of them set means full Real is the target: the old worker-client path is then
// ignored entirely (PINGONE_CLIENT_ID/SECRET are AI-DEMO2's worker credentials and are never used for the user or agent flow).
export const FULL_KEYS = ['CAL_USER_CLIENT_ID', 'CAL_USER_CLIENT_SECRET', 'CAL_AGENT_CLIENT_ID', 'CAL_AGENT_CLIENT_SECRET', 'CAL_DEMO_USERNAME', 'CAL_AGENT_GATEWAY_URL', 'CAL_GATEWAY_AUDIENCE', 'CAL_GATEWAY_SCOPE'];
export const FULL_REQUIRED = ['PINGONE_ENVIRONMENT_ID', ...FULL_KEYS];
// Optional (never required, never makes full Real "wanted"): the scope the agent token and exchange 1 ask for (the scope of the resource whose `act`
// attribute stamps the agent into the token). Empty or absent means the default; the owner's setup script writes it only when it is not the default.
export const DEFAULT_AGENT_SCOPE = 'agent:invoke';
export const OPTIONAL_KEYS = ['CAL_AGENT_SCOPE'];
export const REAL_KEYS = [...LIVE_KEYS, ...FULL_KEYS, ...OPTIONAL_KEYS];
export function readLiveSettings(file) {
  try {
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries(REAL_KEYS.filter((k) => typeof parsed[k] === 'string' && parsed[k] !== '').map((k) => [k, parsed[k]]));
  } catch { return {}; }
}
// The names (never the values) of the required settings that are not set, or still hold an .env.example placeholder (a zero UUID, replace-me, or a
// value whose host or mail domain is an .example / .invalid name).
const PLACEHOLDER = /^(0{8}-0{4}-0{4}-0{4}-0{12}|replace-me)$/i;
const PLACEHOLDER_HOST = /(^|[@./])[^@/\s]*\.(example|invalid)(?=$|[:/?#])/i;
export const isPlaceholder = (v) => PLACEHOLDER.test(String(v)) || PLACEHOLDER_HOST.test(String(v));
const unset = (s, k) => !(k in s) || isPlaceholder(s[k]);
export const missingIn = (s) => LIVE_REQUIRED.filter((k) => unset(s, k));
export const missingLiveSettings = (file) => missingIn(readLiveSettings(file));
// Full Real: wanted when any CAL_* name holds a real value; missing = the required names that do not.
export const fullWanted = (s) => FULL_KEYS.some((k) => !unset(s, k));
export const missingFull = (s) => FULL_REQUIRED.filter((k) => unset(s, k));

// Docker (owner, 2026-11-10): the image has no .env, so docker-compose.yml fills these names from the app's .env by ${VAR:-} substitution and pins
// CAL_LIVE_FROM_ENV=1. Only then are they taken from the environment: a host run never picks up PINGONE_* or CAL_* exported in a shell for another
// project. They are taken ONCE at startup (index.js), deleted from process.env at once, and kept here for live.js, real.js and the doctor, so no other
// module, log line or child sees them. Empty values (a .env without them) count as not set.
let fromEnv = null;
export function takeLiveSettingsFromEnv(env = process.env) {
  if (env.CAL_LIVE_FROM_ENV !== '1') return null;
  fromEnv = Object.fromEntries(REAL_KEYS.filter((k) => typeof env[k] === 'string' && env[k] !== '').map((k) => [k, env[k]]));
  for (const k of REAL_KEYS) delete env[k];
  return fromEnv;
}
// The live settings this process uses: the ones compose passed in (Docker), else the app's .env (host run; CAL_ENV_FILE for tests).
export const liveSettingsFor = (env = process.env) => fromEnv ?? readLiveSettings(settingsPath(env));
