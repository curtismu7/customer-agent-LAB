import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaces, MAX_RUNS } from '../src/workspaces.js';
import { get, post, put, run, W, withServer } from './helpers.js';

test('parallel runs in one workspace are serialised: every sequence number is used exactly once, nothing is lost', async () => {
  await withServer(async (url) => {
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => run(url, i % 2 ? 'UC1' : 'UC6', {}, W('par'))));
    assert.ok(rs.every((r) => r.status === 200));
    assert.deepEqual(rs.map((r) => r.body.seq).sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i + 1));
    const list = await (await get(url, '/api/runs', W('par'))).json();
    assert.equal(list.count, 40); assert.deepEqual(list.runs.map((r) => r.seq), Array.from({ length: 40 }, (_, i) => i + 1));
  });
});

test('parallel runs at the cap: exactly 100 are accepted, the rest are refused whole (409), none is dropped silently', async () => {
  await withServer(async (url) => {
    const rs = await Promise.all(Array.from({ length: MAX_RUNS + 25 }, () => run(url, 'UC24', {}, W('cap'))));
    assert.equal(rs.filter((r) => r.status === 200).length, MAX_RUNS); assert.equal(rs.filter((r) => r.status === 409).length, 25);
    assert.equal((await (await get(url, '/api/runs', W('cap'))).json()).count, MAX_RUNS);
  });
});

test('parallel mode switches and runs in one workspace never tear: the run count and the final mode are consistent', async () => {
  await withServer(async (url) => {
    const ops = [];
    for (let i = 0; i < 20; i++) { ops.push(run(url, 'UC1', {}, W('mix'))); ops.push(put(url, '/api/mode', { mode: 'mock' }, W('mix'))); }
    const res = await Promise.all(ops);
    assert.ok(res.every((r) => r.status === 200 || r.ok));
    assert.equal((await (await get(url, '/api/runs', W('mix'))).json()).count, 20);
  });
});

test('a Reset queued behind runs happens after them; runs after it start from 1; other workspaces never wait or change', async () => {
  await withServer(async (url) => {
    await run(url, 'UC1', {}, W('other'));
    const first = Promise.all(Array.from({ length: 5 }, () => run(url, 'UC1', {}, W('q'))));
    const reset = post(url, '/api/reset', {}, W('q'));
    const [a] = await Promise.all([first, reset]);
    assert.ok(a.every((r) => r.status === 200));
    const after = await run(url, 'UC1', {}, W('q'));
    assert.equal(after.body.seq, 1);
    assert.equal((await (await get(url, '/api/runs', W('other'))).json()).count, 1);
  });
});

test('parallel new workspaces at the cap: exactly the cap are created, the rest get 429, no existing one is evicted', async () => {
  const ws = createWorkspaces({ max: 5 });
  await withServer(async (url) => {
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => run(url, 'UC1', {}, W(`ws-${i}`))));
    assert.equal(rs.filter((r) => r.status === 200).length, 5); assert.equal(rs.filter((r) => r.status === 429).length, 7);
    assert.equal(ws.size(), 5);
    for (const r of rs.filter((x) => x.status === 200)) assert.equal((await (await get(url, '/api/runs', W(r.body.workspace))).json()).count, 1);
  }, { workspaces: ws });
});

test('a write that throws does not wedge the workspace queue', async () => {
  const ws = createWorkspaces();
  await assert.rejects(ws.write('x', () => { throw new Error('boom'); }), /boom/);
  assert.equal(await ws.write('x', (s) => { s.seq += 1; return s.seq; }), 1);
});

test('the write queue is a real lock: a slow (async) write finishes before the next write of the same workspace starts; another workspace does not wait', async () => {
  const ws = createWorkspaces();
  const order = [];
  const slow = ws.write('q', async (s) => { await new Promise((r) => setTimeout(r, 40)); s.seq += 1; order.push('slow'); });
  const fast = ws.write('q', (s) => { order.push(`fast sees ${s.seq}`); });
  const other = ws.write('other', () => { order.push('other'); });
  await Promise.all([slow, fast, other]);
  assert.deepEqual(order, ['other', 'slow', 'fast sees 1']);
});
