import test from 'node:test';
import assert from 'node:assert/strict';
import { SECRETS, NEEDLE } from './secrets.js';
import { get, post, put, rawHttp, run, withServer } from './helpers.js';

test('token-shaped URL path segments never come back (use case, nested paths, long paths)', async () => {
  await withServer(async (url) => {
    for (const [k, v] of Object.entries(SECRETS)) {
      const seg = encodeURIComponent(v);
      for (const p of [`/api/run/${seg}`, `/api/usecases/${seg}`, `/api/${seg}/x`, `/${seg}`, `/api/run/UC1/${seg}`, `/api/runs/${seg}`]) {
        for (const m of ['GET', 'POST', 'PUT', 'DELETE']) {
          const r = await fetch(`${url}${p}`, { method: m, headers: { origin: url, 'content-type': 'application/json' }, body: m === 'POST' || m === 'PUT' ? '{}' : undefined });
          const t = await r.text(); assert.ok(!t.includes(NEEDLE[k]), `${k} ${m} ${p.slice(0, 14)}`); assert.doesNotThrow(() => JSON.parse(t));
        }
      }
    }
  });
});

test('prototype keys are refused at every level: as ids, vertical, persona, mode, track, workspace and as body keys', async () => {
  await withServer(async (url) => {
    for (const k of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf']) {
      assert.equal((await run(url, k)).status, 404, k);
      assert.equal((await run(url, 'UC1', { vertical: k })).status, 400, k);
      assert.equal((await run(url, 'UC1', { persona: k })).status, 400, k);
      assert.equal((await run(url, 'UC1', { mode: k })).status, 400, k);
      assert.equal((await get(url, `/api/usecases?track=${k}`)).status, 400, k);
      assert.equal((await get(url, `/api/usecases?vertical=${k}`)).status, 400, k);
      assert.equal((await get(url, `/api/usecases/${k}`)).status, 404, k);
      assert.equal((await put(url, '/api/mode', { mode: k })).status, 400, k);
      const r = await run(url, 'UC1', {}, { 'x-workspace': k }); assert.ok([200, 400].includes(r.status), `${k} as a workspace id is a plain slug or refused`);
    }
    const raw = await fetch(`${url}/api/run/UC1`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{"__proto__":{"vertical":"retail"},"constructor":{"prototype":{"x":1}}}' });
    assert.equal(raw.status, 400); assert.equal(({}).vertical, undefined, 'no pollution');
    const ok = await run(url, 'UC1'); assert.equal(ok.body.run.vertical, 'banking');
  });
});

test('hostile bodies: deep nesting, huge numbers, wrong types and control characters are bounded and refused', async () => {
  await withServer(async (url) => {
    const deep = `${'['.repeat(2500)}${']'.repeat(2500)}`;
    assert.equal((await fetch(`${url}/api/run/UC1`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: deep })).status, 400);
    assert.equal((await fetch(`${url}/api/run/UC1`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: `{"a":${'{"a":'.repeat(1200)}1${'}'.repeat(1200)}}` })).status, 400);
    for (const b of [{ vertical: 1e999 }, { vertical: null }, { persona: null }, { persona: 1 }, { mode: null }, { vertical: true }, { vertical: '\u0000banking' }, { vertical: 'banking\n' }, { vertical: ' banking' }, { vertical: 'BANKING' }]) assert.equal((await run(url, 'UC1', b)).status, 400, JSON.stringify(b));
    assert.equal((await run(url, 'UC1', { vertical: 'banking', persona: 'standard', mode: 'mock' })).status, 200);
    assert.equal((await fetch(`${url}/api/run/UC1`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: url }, body: '{"vertical":"retail"}' })).status, 200, 'a non-JSON content type is ignored, defaults apply');
  });
});

test('headers: an over-long or malformed traceparent starts a new trace; zero-width characters in an id do not slip through the workspace check', async () => {
  await withServer(async (url) => {
    for (const tp of ['x'.repeat(5000), '00-zz', `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01-extra`]) {
      const r = await post(url, '/api/run/UC1', {}, { traceparent: tp }); assert.equal(r.status, 200);
      const j = await r.json(); assert.notEqual(j.run.traceId, 'a'.repeat(32));
    }
    for (const id of ['team​-a', 'team﻿', 'te‮am']) { const r = await rawHttp(url, { method: 'GET', headers: { 'x-workspace': id } }).catch(() => null); if (r) assert.ok([200, 400, 404].includes(r.status)); }
    const r = await get(url, '/api/runs', { 'x-workspace': 'team-a' }); assert.equal((await r.json()).workspace, 'team-a');
  });
});
