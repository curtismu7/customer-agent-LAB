import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS_KEYS, applySharedSettings, readSharedSettings } from '../src/settings.js';
import { modeFrom, modeOf } from '../src/config.js';

const withFile = (text, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-set-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, text, { mode: 0o600 });
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('only this lab\'s own key is taken from the shared settings file; every other key stays out', () => {
  assert.deepEqual(SETTINGS_KEYS, ['CAL_LAB_MODE']);
  withFile('PINGONE_CLIENT_SECRET=hunter2hunter2\nMODE=live\nPORT=9999\nCAL_LAB_MODE=live\nCAL_ALLOW_LIVE=1\nALLOW_MOCK_SIGNIN=1\n# a comment\nOTHER_APP_TOKEN="x y"\n', (f) => {
    assert.deepEqual(readSharedSettings(f), { CAL_LAB_MODE: 'live' });
    const env = { HOME: '/x' };
    applySharedSettings(env, f);
    assert.deepEqual(Object.keys(env).sort(), ['CAL_LAB_MODE', 'HOME'], 'the guards\' keys (CAL_ALLOW_LIVE, ALLOW_MOCK_SIGNIN) can never be switched on from the shared file');
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
