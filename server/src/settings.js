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
// CAL_ALLOW_LIVE, IDP and ALLOW_MOCK_SIGNIN stay shell opt-ins at launch.
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

// The live settings (step 3): the PingOne environment and the worker client, read from the same file with util.parseEnv. They are NEVER copied into
// process.env (applySharedSettings above takes SETTINGS_KEYS only), so no other module, log line or child can see the secret; live.js holds it in a closure.
export const LIVE_KEYS = ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'];
// The keys Live cannot run without (PINGONE_REGION defaults to com).
export const LIVE_REQUIRED = ['PINGONE_ENVIRONMENT_ID', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'];
export function readLiveSettings(file) {
  try {
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries(LIVE_KEYS.filter((k) => typeof parsed[k] === 'string' && parsed[k] !== '').map((k) => [k, parsed[k]]));
  } catch { return {}; }
}
// The names (never the values) of the required Live settings the file does not set, or still holds at the .env.example placeholder.
const PLACEHOLDER = /^(0{8}-0{4}-0{4}-0{4}-0{12}|replace-me)$/i;
export const missingLiveSettings = (file) => { const s = readLiveSettings(file); return LIVE_REQUIRED.filter((k) => !(k in s) || PLACEHOLDER.test(s[k])); };
