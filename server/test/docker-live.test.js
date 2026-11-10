// Real in Docker (owner, 2026-11-10): compose passes the four PINGONE_* names by ${VAR:-} substitution plus CAL_LIVE_FROM_ENV=1. These tests start the
// real entry point as a child with FAKE values only (fakePingone.js) and never make a call: a run is never asked for, so nothing reaches PingOne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_KEYS, REAL_KEYS, liveSettingsFor, takeLiveSettingsFromEnv } from '../src/settings.js';
import { fullSettingsFor, settingsFor } from './fakePingone.js';

const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-docker-'));
const empty = path.join(dir, 'empty.env');
fs.writeFileSync(empty, '', { mode: 0o600 });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Starts the lab like the container does (no settings file: CAL_ENV_FILE is an empty one), waits for it, returns its first log line and /api/info.
async function boot(port, extra) {
  const env = { ...process.env, PORT: String(port), CAL_ENV_FILE: empty, ALLOW_MOCK_SIGNIN: '1', ...extra };
  for (const k of ['CALAB_BIND', 'CAL_LAB_MODE', 'IDP', 'CAL_ALLOW_LIVE', 'CAL_LIVE_TEST_BASE', 'CAL_DEPLOY_MODE', ...REAL_KEYS]) if (!(k in extra)) delete env[k];
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = ''; child.stdout.on('data', (c) => { out += c; });
  try {
    for (let i = 0; i < 200; i++) {
      try {
        const info = await (await fetch(`http://127.0.0.1:${port}/api/info`)).json();
        const mode = await (await fetch(`http://127.0.0.1:${port}/api/mode`)).json();
        return { log: out.split('\n')[0], info, mode };
      } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('the lab did not start');
  } finally { child.kill(); }
}

test('takeLiveSettingsFromEnv: only with CAL_LIVE_FROM_ENV=1, only the four names, empty values are not set, and they leave the environment', () => {
  const shell = { ...settingsFor(), OTHER: 'x' };
  assert.equal(takeLiveSettingsFromEnv(shell), null, 'a host run never takes PINGONE_* from a shell');
  assert.ok(LIVE_KEYS.every((k) => k in shell), 'and leaves them alone');
  const env = { CAL_LIVE_FROM_ENV: '1', ...settingsFor(), PINGONE_REGION: '', PINGONE_ADMIN_PASSWORD: 'nope' };
  assert.deepEqual(Object.keys(takeLiveSettingsFromEnv(env)).sort(), ['PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET', 'PINGONE_ENVIRONMENT_ID']);
  assert.ok(LIVE_KEYS.every((k) => !(k in env)), 'deleted from the environment at once');
  assert.equal(env.PINGONE_ADMIN_PASSWORD, 'nope', 'nothing else is touched');
  assert.deepEqual(Object.keys(liveSettingsFor({})).sort(), ['PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET', 'PINGONE_ENVIRONMENT_ID'], 'the process then uses the taken ones');
});

test('Docker with the PingOne settings: Real is available, Mock sign-in too, and the netguard allows only the PingOne host', async () => {
  const r = await boot(5680, { CAL_LIVE_FROM_ENV: '1', CAL_PUBLISH: 'loopback', ...settingsFor() });
  assert.equal(r.info.realAvailable, true); assert.equal(r.info.guards.live, 'allowed'); assert.equal(r.info.guards.mockSignIn, 'allowed');
  assert.equal(r.mode.liveReason, null);
  assert.match(r.log, /Real \(identity provider only\) is on: outbound only to https:\/\/auth\.pingone\.com\)/, 'the one host the netguard allows');
  assert.equal(r.info.real.level, 'idp-only', 'no CAL_* settings: the old two-call path, labelled identity provider only');
  assert.doesNotMatch(r.log, new RegExp(settingsFor().PINGONE_ENVIRONMENT_ID), 'the log names the host, never the environment id');
});

test('Docker with no .env (compose passes empty values): Mock only, Real disabled with the how-to, and the netguard allows nothing', async () => {
  const blank = Object.fromEntries(REAL_KEYS.map((k) => [k, '']));
  const r = await boot(5681, { CAL_LIVE_FROM_ENV: '1', CAL_PUBLISH: 'loopback', CAL_ALLOW_LIVE: '', ...blank });
  assert.equal(r.info.realAvailable, false); assert.equal(r.info.guards.mockSignIn, 'allowed');
  assert.match(r.mode.liveReason, /^Real is not configured: fill PINGONE_ENVIRONMENT_ID, CAL_USER_CLIENT_ID, CAL_USER_CLIENT_SECRET, CAL_AGENT_CLIENT_ID, CAL_AGENT_CLIENT_SECRET, CAL_DEMO_USERNAME, CAL_AGENT_GATEWAY_URL, CAL_GATEWAY_AUDIENCE, CAL_GATEWAY_SCOPE in this app's \.env/);
  assert.deepEqual(r.info.real.missing, ['PINGONE_ENVIRONMENT_ID', 'CAL_USER_CLIENT_ID', 'CAL_USER_CLIENT_SECRET', 'CAL_AGENT_CLIENT_ID', 'CAL_AGENT_CLIENT_SECRET', 'CAL_DEMO_USERNAME', 'CAL_AGENT_GATEWAY_URL', 'CAL_GATEWAY_AUDIENCE', 'CAL_GATEWAY_SCOPE']);
  assert.match(r.log, /no outbound network/);
});

test('takeLiveSettingsFromEnv takes and removes every Real setting, the CAL_* secrets included', () => {
  const env = { CAL_LIVE_FROM_ENV: '1', ...fullSettingsFor('https://gw.lab-test.net/mcp'), OTHER: 'x' };
  const taken = takeLiveSettingsFromEnv(env);
  assert.deepEqual(Object.keys(taken).sort(), Object.keys(fullSettingsFor('')).sort());
  assert.deepEqual(Object.keys(env).sort(), ['CAL_LIVE_FROM_ENV', 'OTHER'], 'no Real setting is left in the environment');
});

test('Docker with the full-Real settings (and the old worker client too): full Real, the netguard allows the PingOne and gateway hosts only, the worker client ignored', async () => {
  const r = await boot(5685, { CAL_LIVE_FROM_ENV: '1', CAL_PUBLISH: 'loopback', ...settingsFor(), ...fullSettingsFor('https://gw.lab-test.net/mcp') });
  assert.equal(r.info.realAvailable, true); assert.equal(r.info.real.level, 'full'); assert.deepEqual(r.info.real.missing, []);
  assert.equal(r.info.liveSettings.configured, false, 'the old worker-client path is not built');
  assert.match(r.log, /full Real is on: outbound only to https:\/\/auth\.pingone\.com and https:\/\/gw\.lab-test\.net\)/);
  assert.doesNotMatch(r.log, new RegExp(settingsFor().PINGONE_ENVIRONMENT_ID), 'the log names hosts, never the environment id');
});

test('Docker with only some full-Real settings: Real disabled, the missing ones named, the worker client ignored', async () => {
  const partial = { ...fullSettingsFor('https://gw.lab-test.net/mcp') }; delete partial.CAL_AGENT_CLIENT_SECRET; delete partial.CAL_GATEWAY_SCOPE;
  const r = await boot(5686, { CAL_LIVE_FROM_ENV: '1', CAL_PUBLISH: 'loopback', ...settingsFor(), ...partial });
  assert.equal(r.info.realAvailable, false); assert.deepEqual(r.info.real.missing, ['CAL_AGENT_CLIENT_SECRET', 'CAL_GATEWAY_SCOPE']);
  assert.match(r.log, /no outbound network/);
});

test('Docker with the settings and CAL_ALLOW_LIVE=0: Real is off and the netguard allows nothing', async () => {
  const r = await boot(5682, { CAL_LIVE_FROM_ENV: '1', CAL_PUBLISH: 'loopback', CAL_ALLOW_LIVE: '0', ...settingsFor() });
  assert.equal(r.info.realAvailable, false); assert.match(r.mode.liveReason, /CAL_ALLOW_LIVE=0/);
  assert.match(r.log, /no outbound network/);
});

test('a host run ignores PINGONE_* exported in the shell (no CAL_LIVE_FROM_ENV): Mock only', async () => {
  const r = await boot(5683, { ...settingsFor() });
  assert.equal(r.info.realAvailable, false); assert.match(r.log, /no outbound network/);
});

test('the hosted build still refuses Real even with the settings in its environment', async () => {
  const r = await boot(5684, { CAL_DEPLOY_MODE: 'hosted', CAL_LIVE_FROM_ENV: '1', ...settingsFor() });
  assert.equal(r.info.realAvailable, false); assert.match(r.mode.liveReason, /hosted build/); assert.match(r.log, /no outbound network/);
});
