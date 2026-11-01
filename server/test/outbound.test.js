import test from 'node:test';
import assert from 'node:assert/strict';
import { installNetguard } from '../src/netguard.js';
import { MANIFEST } from '../src/manifest.js';
import { get, post, put, run, W, withServer } from './helpers.js';

test('zero outbound attempts across the whole API: every use case, every endpoint, the doctor checks and the engine, with the netguard on', async () => {
  const guard = installNetguard();
  try {
    const { runChecks } = await import('../src/doctor.js');
    await runChecks({ env: {} });
    await withServer(async (url) => {
      for (const [i, uc] of MANIFEST.usecases.entries()) await run(url, uc.id, { vertical: ['banking', 'healthcare', 'retail'][i % 3] }, W(`out-${i % 4}`));
      for (const p of ['/api/health', '/api/info', '/api/story', '/api/usecases', '/api/usecases/UC1', '/api/mode', '/api/runs', '/api/nope']) await get(url, p);
      await put(url, '/api/mode', { mode: 'live' }); await put(url, '/api/mode', { mode: 'mock' }); await post(url, '/api/reset', {});
      await run(url, 'UC12', { mode: 'live' });
    });
    assert.deepEqual(guard.attempts, [], 'no socket, DNS, fetch or UDP attempt left the machine');
    const urls = MANIFEST.usecases.map((uc) => JSON.stringify(uc)).join('');
    assert.ok(!/https?:\/\//.test(urls), 'the manifest holds no URL');
  } finally { guard.restore(); }
});

test('the guard is really on while the API runs: an outbound fetch from the same process is refused and counted', async () => {
  const guard = installNetguard();
  try {
    await assert.rejects(fetch('https://not-allowed.invalid/', { signal: AbortSignal.timeout(1500) }), /network blocked/);
    assert.deepEqual(guard.attempts, ['fetch:not-allowed.invalid']);
  } finally { guard.restore(); }
});
