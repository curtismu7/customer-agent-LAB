import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ENV_FILE, LIVE_KEYS, SETTINGS_KEYS, applySharedSettings, missingLiveSettings, readLiveSettings, readSharedSettings, settingsPath } from '../src/settings.js';
import { modeFrom, modeOf } from '../src/config.js';

const withFile = (text, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-set-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, text, { mode: 0o600 });
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('only this lab\'s own key is taken from the app\'s .env; every other key stays out', () => {
  assert.deepEqual(SETTINGS_KEYS, ['CAL_LAB_MODE', 'LAB_ALLOWED_HOSTS', 'SHELF_URL']);
  withFile('PINGONE_CLIENT_SECRET=hunter2hunter2\nMODE=live\nPORT=9999\nCAL_LAB_MODE=live\nCAL_ALLOW_LIVE=1\nALLOW_MOCK_SIGNIN=1\n# a comment\nOTHER_APP_TOKEN="x y"\n', (f) => {
    assert.deepEqual(readSharedSettings(f), { CAL_LAB_MODE: 'live' });
    const env = { HOME: '/x' };
    applySharedSettings(env, f);
    assert.deepEqual(Object.keys(env).sort(), ['CAL_LAB_MODE', 'HOME'], 'the guards\' keys (CAL_ALLOW_LIVE, ALLOW_MOCK_SIGNIN) can never be switched on from the .env');
  });
});

test('the environment wins over the file; a missing, empty or unreadable file is the defaults', () => {
  withFile('CAL_LAB_MODE=live\n', (f) => assert.equal(applySharedSettings({ CAL_LAB_MODE: 'mock' }, f).CAL_LAB_MODE, 'mock'));
  assert.deepEqual(readSharedSettings('/nonexistent/.env'), {});
  withFile('', (f) => assert.deepEqual(readSharedSettings(f), {}));
  withFile('CAL_LAB_MODE=\n', (f) => assert.deepEqual(readSharedSettings(f), {}));
  assert.deepEqual(readSharedSettings(os.tmpdir()), {}, 'a directory is not a settings file');
});

test('the mode is mock or live; mock is the default; a bare MODE (another app\'s) is ignored; anything else is an error, not a fallback', () => {
  assert.equal(modeFrom({}), 'mock'); assert.equal(modeFrom({ MODE: 'live' }), 'mock'); assert.equal(modeFrom({ CAL_LAB_MODE: 'live' }), 'live'); assert.equal(modeFrom({ CAL_LAB_MODE: '' }), 'mock');
  assert.throws(() => modeFrom({ CAL_LAB_MODE: 'prod' }), /not available/);
  assert.equal(modeOf('mock'), 'mock'); assert.equal(modeOf('live'), 'live');
  for (const bad of ['Mock', 'prod', '', undefined, null, 1, ['mock'], { toString: () => 'mock' }, '__proto__']) assert.equal(modeOf(bad), null);
});

test('step 3: the PingOne settings are read for live.js only, with util.parseEnv and only the four listed keys; they are never copied into the environment', () => {
  assert.deepEqual(LIVE_KEYS, ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET']);
  withFile('PINGONE_ENVIRONMENT_ID=env-1\nPINGONE_REGION=eu\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=csec\nPINGONE_ADMIN_PASSWORD=nope\nCAL_ALLOW_LIVE=1\nIDP=pingone\nPORT=1\nPINGONE_CLIENT_SECRET_OLD=x\n', (f) => {
    assert.deepEqual(readLiveSettings(f), { PINGONE_ENVIRONMENT_ID: 'env-1', PINGONE_REGION: 'eu', PINGONE_CLIENT_ID: 'cid', PINGONE_CLIENT_SECRET: 'csec' });
    const env = {}; applySharedSettings(env, f);
    assert.deepEqual(env, {}, 'applySharedSettings copies none of them, and none of the guard keys');
    assert.deepEqual(readSharedSettings(f), {});
  });
  withFile('PINGONE_CLIENT_ID=\n', (f) => assert.deepEqual(readLiveSettings(f), {}));
  assert.deepEqual(readLiveSettings('/nonexistent/.env'), {}); assert.deepEqual(readLiveSettings(os.tmpdir()), {});
});

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('owner 2026-11-09: the settings file is this app\'s own .env at the repo root (beside docker-compose.yml), resolved from the code, not the cwd or the home directory', () => {
  assert.equal(APP_ENV_FILE, path.join(REPO_ROOT, '.env'));
  assert.ok(fs.existsSync(path.join(path.dirname(APP_ENV_FILE), 'docker-compose.yml')), 'the .env sits beside docker-compose.yml');
  assert.equal(settingsPath({}), APP_ENV_FILE);
  assert.equal(settingsPath({ HOME: '/elsewhere', [['STANDALONE', 'ENV'].join('_')]: '/elsewhere/.env' }), APP_ENV_FILE, 'neither HOME nor the retired override variable moves it');
  const cwd = process.cwd();
  try { process.chdir(os.tmpdir()); assert.equal(settingsPath({}), APP_ENV_FILE); } finally { process.chdir(cwd); }
  assert.equal(settingsPath({ CAL_ENV_FILE: '/tmp/x.env' }), '/tmp/x.env', 'CAL_ENV_FILE (tests and e2e) points at another file');
});

test('the names the owner\'s .env holds are the names the lab reads: LAB_ALLOWED_HOSTS and SHELF_URL into the environment, the four PINGONE_* for live.js only (fake values)', () => {
  withFile('LAB_ALLOWED_HOSTS=lab.example\nSHELF_URL=https://shelf.example:8443\nPINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_REGION=com\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=fake-secret\n', (f) => {
    const env = {}; applySharedSettings(env, f);
    assert.deepEqual(env, { LAB_ALLOWED_HOSTS: 'lab.example', SHELF_URL: 'https://shelf.example:8443' });
    assert.deepEqual(Object.keys(readLiveSettings(f)), LIVE_KEYS);
    assert.deepEqual(applySharedSettings({ LAB_ALLOWED_HOSTS: 'shell.example' }, f).LAB_ALLOWED_HOSTS, 'shell.example', 'the shell wins');
  });
});

test('Live config loading from the app\'s .env: present, missing and partial (fake values only)', () => {
  withFile('PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_REGION=eu\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=fake-secret\n', (f) => {
    assert.deepEqual(Object.keys(readLiveSettings(f)), LIVE_KEYS); assert.deepEqual(missingLiveSettings(f), []);
  });
  assert.deepEqual(missingLiveSettings('/nonexistent/.env'), ['PINGONE_ENVIRONMENT_ID', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'], 'missing file: every required name');
  withFile('PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_SECRET=\n', (f) => {
    assert.deepEqual(missingLiveSettings(f), ['PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'], 'partial: the unset and the empty ones');
  });
  withFile(fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8'), (f) => {
    assert.deepEqual(missingLiveSettings(f), ['PINGONE_ENVIRONMENT_ID', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'], 'an unfilled copy of .env.example still counts as missing');
    assert.deepEqual(readSharedSettings(f), { CAL_LAB_MODE: 'mock' }, 'empty placeholders are not taken');
  });
});

test('.env.example lists the names with placeholder values only; .env is git-ignored and docker-ignored', () => {
  const ex = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
  const parsed = Object.fromEntries(ex.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  for (const k of [...LIVE_KEYS, ...SETTINGS_KEYS]) assert.ok(k in parsed, k);
  assert.equal(parsed.LAB_ALLOWED_HOSTS, '');
  assert.equal(parsed.PINGONE_ENVIRONMENT_ID, '00000000-0000-0000-0000-000000000000'); assert.equal(parsed.PINGONE_CLIENT_ID, '00000000-0000-0000-0000-000000000000');
  assert.equal(parsed.PINGONE_CLIENT_SECRET, 'replace-me'); assert.equal(parsed.SHELF_URL, '');
  for (const f of ['.gitignore', '.dockerignore']) assert.match(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), /^\.env$/m, f);
});
