import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaces, workspaceFrom, WORKSPACE_RE, DEFAULT_WORKSPACE } from '../src/workspaces.js';
import { SECRETS } from './secrets.js';

test('the workspace id: absent is default; a lowercase slug is kept; everything else (and anything credential-shaped) is null', () => {
  const f = (h) => workspaceFrom({ headers: h });
  assert.equal(f({}), DEFAULT_WORKSPACE); assert.equal(f({ 'x-workspace': 'team-a' }), 'team-a');
  for (const bad of ['', 'A', 'a b', 'a_b', 'x'.repeat(41), '../x', ['a'], undefined === 1, SECRETS.hex, SECRETS.hex40, SECRETS.key31, SECRETS.shortGh, SECRETS.skShort]) assert.equal(f({ 'x-workspace': bad }), null, String(bad));
  assert.ok(WORKSPACE_RE.test('a') && WORKSPACE_RE.test('a'.repeat(40)));
});

test('a new workspace is refused at the cap (nothing evicted); an idle one expires after the ttl and frees its place', async () => {
  let t = 1000;
  const ws = createWorkspaces({ max: 2, ttlMs: 100, now: () => t });
  await ws.write('a', (s) => { s.seq = 1; }); t += 10; await ws.write('b', (s) => { s.seq = 2; });
  await assert.rejects(ws.write('c', () => {}), (err) => err.status === 429 && err.code === 'too_many_workspaces');
  assert.equal(ws.peek('a').seq, 1);
  t += 95; await ws.write('b', () => {}); // keeps b fresh
  t += 20; // a (last touched 105 ago) is now idle, b is not
  await ws.write('c', (s) => { s.seq = 3; });
  assert.equal(ws.peek('a').seq, 0, 'a expired'); assert.equal(ws.peek('b').seq, 2); assert.equal(ws.peek('c').seq, 3);
});

test('peek never creates a workspace and returns a fresh default for an unknown one', () => {
  const ws = createWorkspaces({ defaultMode: 'live' });
  assert.deepEqual(ws.peek('nope'), { mode: 'live', seq: 0, runs: [] }); assert.equal(ws.size(), 0);
});

test('review fix: a new workspace never inherits the state of an existing "default" workspace', async () => {
  const ws = createWorkspaces();
  await ws.write(DEFAULT_WORKSPACE, (s) => { s.seq = 7; s.mode = 'live'; s.runs.push({ id: 'UC1' }); });
  let seen;
  await ws.write('b', (s) => { seen = { seq: s.seq, mode: s.mode, runs: s.runs.length }; s.seq = 1; });
  assert.deepEqual(seen, { seq: 0, mode: 'mock', runs: 0 });
  assert.equal(ws.peek(DEFAULT_WORKSPACE).seq, 7); assert.equal(ws.peek(DEFAULT_WORKSPACE).runs.length, 1); assert.equal(ws.peek('b').seq, 1);
  assert.deepEqual(ws.peek('never-written'), { mode: 'mock', seq: 0, runs: [] });
});
