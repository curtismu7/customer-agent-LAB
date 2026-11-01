import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, startHttpServer } from '../server/src/app.js';
import { createHealth } from '../server/src/health.js';
import { createWorkspaces } from '../server/src/workspaces.js';
import { reset } from './reset.mjs';
import { smoke } from './smoke.mjs';

async function withLab(fn, workspaces = createWorkspaces()) {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, workspaces, env: { ALLOW_MOCK_SIGNIN: '1' } }) });
  try { await fn(url.replace(/\/$/, ''), workspaces); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

test('the reset script clears the default workspace and refuses a non-loopback host', async () => {
  await withLab(async (base, workspaces) => {
    await workspaces.write('default', (s) => { s.runs.push({ seq: 1 }); s.seq = 1; }); await workspaces.write('other', (s) => { s.seq = 5; });
    assert.equal(workspaces.peek('default').runs.length, 1);
    assert.deepEqual(await reset(base), { reset: 'ok', workspace: 'default' });
    assert.equal(workspaces.peek('default').runs.length, 0); assert.equal(workspaces.peek('other').seq, 5, 'another workspace is untouched');
    await assert.rejects(reset('http://example.invalid:5600'), /loopback only/);
  });
});

test('the smoke script passes against a running lab and refuses a non-loopback host', async () => {
  await withLab(async (base) => {
    const results = await smoke(base);
    assert.deepEqual(results.map((r) => r.ok), [true, true, true, true], JSON.stringify(results));
    await assert.rejects(smoke('http://example.invalid:5600'), /loopback only/);
  });
});

test('the smoke script FAILS (does not pass quietly) when mock sign-in is off', async () => {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, env: {} }) });
  try { const results = await smoke(url.replace(/\/$/, '')); assert.equal(results.find((r) => /UC1 runs/.test(r.name)).ok, false); } finally { health.stop(); await new Promise((r) => server.close(r)); }
});
