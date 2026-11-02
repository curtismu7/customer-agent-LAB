// The one shared settings file (rulebook): ~/Development/.env, or the path in STANDALONE_ENV. Every standalone app reads it, so it
// holds other apps' keys too. This lab takes ONLY the keys listed below and ignores everything else: nothing else from the file
// ever enters the server's environment, and no value is printed. Read only; the lab never writes it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const SETTINGS_KEYS = ['CAL_LAB_MODE'];
export const settingsPath = (env = process.env) => env.STANDALONE_ENV || path.join(os.homedir(), 'Development', '.env');

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

// The live settings (step 3): the PingOne environment and the worker client, read from the same shared file with util.parseEnv. They are NEVER copied into
// process.env (applySharedSettings above takes SETTINGS_KEYS only), so no other module, log line or child can see the secret; live.js holds it in a closure.
export const LIVE_KEYS = ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'];
export function readLiveSettings(file) {
  try {
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries(LIVE_KEYS.filter((k) => typeof parsed[k] === 'string' && parsed[k] !== '').map((k) => [k, parsed[k]]));
  } catch { return {}; }
}
