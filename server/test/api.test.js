import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaces, MAX_RUNS } from '../src/workspaces.js';
import { MANIFEST, TRACKS } from '../src/manifest.js';
import { get, post, put, run, W, withServer } from './helpers.js';
import { SECRETS, NEEDLE } from './secrets.js';

test('GET /api/health is demo-health/1, public, GET only, no store, small', async () => {
  await withServer(async (url) => {
    const r = await get(url, '/api/health'); const j = await r.json();
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
    assert.equal(j.schema, 'demo-health/1'); assert.equal(j.state, 'ready'); assert.equal(j.runtime, 'offline');
    assert.deepEqual(Object.keys(j.demo).sort(), ['id', 'name', 'version']); assert.equal(j.demo.id, 'customer-agent-lab');
    assert.match(j.at, /^\d{4}-\d\d-\d\dT/);
    assert.ok(JSON.stringify(j).length < 400);
    const bad = await post(url, '/api/health', {}); assert.equal(bad.status, 405); assert.equal(bad.headers.get('allow'), 'GET');
  });
});

test('GET /api/usecases is grouped by track, all 87, filterable by track and vertical, with the tool resolved for the vertical', async () => {
  await withServer(async (url) => {
    const j = await (await get(url, '/api/usecases')).json();
    assert.equal(j.total, 87); assert.deepEqual(j.tracks.map((t) => [t.track, t.count]), Object.entries(TRACKS));
    assert.equal(j.vertical, 'banking'); assert.equal(j.pack, 'full'); assert.match(j.source.commit, /^[0-9a-f]{40}$/);
    const hc = await (await get(url, '/api/usecases?vertical=healthcare&track=controls')).json();
    assert.equal(hc.total, 16); assert.equal(hc.tracks.length, 1);
    assert.equal(hc.tracks[0].usecases.find((u) => u.id === 'UC6').tool, 'pay_bill');
    assert.equal(j.tracks[2].usecases.find((u) => u.id === 'UC6').tool, 'create_transfer');
    const stub = await (await get(url, '/api/usecases?vertical=government')).json();
    assert.equal(stub.pack, 'stub'); assert.equal(stub.total, 87);
    const one = await (await get(url, '/api/usecases/UC12')).json();
    assert.equal(one.usecase.flag, 'ff_dpop'); assert.equal(one.usecase.live.status, 'needs-flag');
    assert.equal((await get(url, '/api/usecases/nope')).status, 404);
    assert.equal((await get(url, '/api/usecases/__proto__')).status, 404);
  });
});

test('bad query values are 400 with fixed text, and nothing typed comes back', async () => {
  await withServer(async (url) => {
    for (const q of ['vertical=zzz', 'vertical=__proto__', 'vertical[]=banking', 'track=zzz', 'track=constructor', 'track[a]=b']) {
      const r = await get(url, `/api/usecases?${q}`); assert.equal(r.status, 400, q);
      const t = await r.text(); assert.ok(!/zzz|__proto__|constructor/.test(t), q);
    }
    assert.equal((await get(url, '/api/story?vertical=nope')).status, 400);
    assert.equal((await get(url, '/api/story?vertical=government')).status, 501);
    const s = await (await get(url, '/api/story?vertical=retail')).json();
    assert.equal(s.cast.castBrand, 'Northwind Retail'); assert.equal(s.total, 87); assert.ok(!JSON.stringify(s).includes('{{'));
  });
});

test('POST /api/run/:id runs a use case in mock and returns the full record', async () => {
  await withServer(async (url) => {
    const { status, body } = await run(url, 'UC1', { vertical: 'retail' });
    assert.equal(status, 200); assert.equal(body.ok, true); assert.equal(body.workspace, 'default'); assert.equal(body.seq, 1);
    const r = body.run;
    assert.equal(r.mode, 'mock'); assert.equal(r.outcome, 'PERMIT'); assert.equal(r.matchesExpected, true); assert.equal(r.vertical, 'retail');
    assert.equal(r.hops.at(-1).request.body.params.name, 'list_orders');
    assert.ok(r.tokens.every((t) => t.mock && /MOCK/.test(t.label)));
    assert.ok(r.tokens.every((t) => t.notice === 'MOCK token, issued by this lab and signed with a public mock key'), 'the notice reaches the client unmangled by the response mask');
    assert.ok(r.tokens[0].raw.startsWith('eyJ'), 'rule 4: the MOCK token is shown raw, not masked');
    assert.ok(r.hops[0].response.body.access_token.startsWith('eyJ') && !r.hops[0].response.body.access_token.includes('masked'));
    assert.match(JSON.stringify(r.hops), /Bearer eyJ/);
  });
});

test('every one of the 87 use cases runs over HTTP and matches its expected outcome, in every full vertical', async () => {
  await withServer(async (url) => {
    let n = 0;
    for (const v of ['banking', 'healthcare', 'retail']) for (const uc of MANIFEST.usecases) {
      const ws = W(`all-${v}`);
      let r = await run(url, uc.id, { vertical: v }, ws);
      if (r.status === 409) { await post(url, '/api/reset', {}, ws); r = await run(url, uc.id, { vertical: v }, ws); } // a workspace holds 100 runs: Reset and go on
      assert.equal(r.status, 200, `${v}/${uc.id}`); assert.equal(r.body.run.outcome, uc.expectedOutcome, `${v}/${uc.id}`); n++;
    }
    assert.equal(n, 261);
  });
});

test('honest status codes on /run: unknown use case 404, bad persona 400, bad vertical 400, stub vertical 501, bad mode 400, unknown field 400', async () => {
  await withServer(async (url) => {
    assert.equal((await run(url, 'NOPE')).status, 404);
    assert.equal((await run(url, '__proto__')).status, 404);
    assert.equal((await run(url, 'UC1', { persona: 'admin' })).status, 400);
    assert.equal((await run(url, 'UC1', { persona: ['standard'] })).status, 400);
    assert.equal((await run(url, 'UC1', { vertical: 'nope' })).status, 400);
    assert.equal((await run(url, 'UC1', { vertical: 'constructor' })).status, 400);
    const stub = await run(url, 'UC1', { vertical: 'government' }); assert.equal(stub.status, 501); assert.equal(stub.body.error, 'vertical_stub');
    assert.equal((await run(url, 'UC1', { mode: 'prod' })).status, 400);
    const unk = await run(url, 'UC1', { vertical: 'banking', extra: 1 }); assert.equal(unk.status, 400); assert.equal(unk.body.error, 'unknown_field'); assert.ok(!JSON.stringify(unk.body).includes('extra'));
    const arr = await post(url, '/api/run/UC1', [1]); assert.equal(arr.status, 400);
    assert.equal((await post(url, '/api/run/UC1', 'x')).status, 400);
    const big = await post(url, '/api/run/UC1', { vertical: 'x'.repeat(20000) }); assert.equal(big.status, 413);
    const broken = await fetch(`${url}/api/run/UC1`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{"a":' }); assert.equal(broken.status, 400);
  });
});

test('persona on /run overrides the lab default and the record says it did not match', async () => {
  await withServer(async (url) => {
    const a = await run(url, 'UC21', { persona: 'standard' });
    assert.equal(a.body.run.outcome, 'DENY_403'); assert.equal(a.body.run.matchesExpected, false); assert.equal(a.body.run.persona, 'standard');
    const b = await run(url, 'UC21'); assert.equal(b.body.run.outcome, 'PERMIT'); assert.equal(b.body.run.persona, 'premium');
  });
});

test('rule 11: a mock run is refused (403) unless ALLOW_MOCK_SIGNIN=1, IDP is mock, no proxy header, loopback bind; Docker\'s publish flag is the one exception', async () => {
  const cases = [
    [{ env: {} }, 403, /ALLOW_MOCK_SIGNIN=1/],
    [{ env: { ALLOW_MOCK_SIGNIN: '1', IDP: 'live' } }, 403, /IDP is not mock/],
    [{ env: { ALLOW_MOCK_SIGNIN: '1' }, bind: '0.0.0.0' }, 403, /non-loopback/],
    [{ env: { ALLOW_MOCK_SIGNIN: '1', CAL_PUBLISH: 'loopback' }, bind: '0.0.0.0' }, 200, null],
    [{ env: { ALLOW_MOCK_SIGNIN: '1', NODE_ENV: 'production' } }, 200, null],
  ];
  for (const [opts, status, re] of cases) {
    await withServer(async (url) => {
      const r = await run(url, 'UC1'); assert.equal(r.status, status, JSON.stringify(opts));
      if (re) { assert.match(r.body.detail, re); assert.equal(r.body.error, 'mock_signin_refused'); }
    }, opts);
  }
  await withServer(async (url) => {
    const r = await post(url, '/api/run/UC1', {}, { 'x-forwarded-for': '203.0.113.9' }); assert.equal(r.status, 403); assert.match((await r.json()).detail, /proxy/);
    assert.equal((await get(url, '/api/usecases', { 'x-forwarded-for': '203.0.113.9' })).status, 200, 'reads need no sign-in guard');
  });
});

test('live mode: selecting it is refused (403) unless every guard is satisfied; when satisfied a live run is still refused honestly (501)', async () => {
  await withServer(async (url) => {
    const before = await (await get(url, '/api/mode')).json();
    assert.equal(before.mode, 'mock'); assert.equal(before.live, 'refused'); assert.match(before.liveReason, /CAL_ALLOW_LIVE=1/);
    const r = await put(url, '/api/mode', { mode: 'live' }); assert.equal(r.status, 403); assert.equal((await r.json()).error, 'live_not_allowed');
    assert.equal((await (await get(url, '/api/mode')).json()).mode, 'mock', 'a refused switch changes nothing');
    const direct = await run(url, 'UC1', { mode: 'live' }); assert.equal(direct.status, 403); assert.equal(direct.body.error, 'live_not_allowed');
    assert.equal((await (await put(url, '/api/mode', { mode: 'mock' })).json()).mode, 'mock');
  });
  await withServer(async (url) => {
    const r = await put(url, '/api/mode', { mode: 'live' }); assert.equal(r.status, 200); assert.equal((await r.json()).mode, 'live');
    const out = await run(url, 'UC12');
    assert.equal(out.status, 501); assert.equal(out.body.error, 'live_not_built'); assert.match(out.body.detail, /step 3/);
    assert.equal(out.body.live.status, 'needs-flag'); assert.equal(out.body.live.needs, 'ff_dpop');
    const back = await run(url, 'UC12', { mode: 'mock' }); assert.equal(back.status, 403, 'a live IDP turns the mock persona sign-in off, so a mock run is refused too'); assert.equal(back.body.error, 'mock_signin_refused');
    assert.equal((await (await get(url, '/api/mode', { 'x-workspace': 'other' })).json()).mode, 'mock', 'another workspace is still in mock');
  }, { env: { ALLOW_MOCK_SIGNIN: '1', CAL_ALLOW_LIVE: '1', IDP: 'pingone' } });
  await withServer(async (url) => {
    assert.equal((await put(url, '/api/mode', { mode: 'live' }, { 'x-forwarded-host': 'x' })).status, 403, 'behind a proxy');
    assert.equal((await put(url, '/api/mode', { mode: 'live' })).status, 403, 'non-loopback bind');
  }, { env: { CAL_ALLOW_LIVE: '1', IDP: 'pingone' }, bind: '0.0.0.0' });
});

test('PUT /api/mode: bad mode 400, unknown field 400, a non-object body 400', async () => {
  await withServer(async (url) => {
    for (const b of [{ mode: 'prod' }, { mode: 1 }, {}, { mode: ['mock'] }, { mode: 'mock', x: 1 }]) assert.equal((await put(url, '/api/mode', b)).status, 400, JSON.stringify(b));
    assert.equal((await put(url, '/api/mode', [1])).status, 400);
  });
});

test('Reset clears this workspace only, and puts its mode back', async () => {
  await withServer(async (url) => {
    await run(url, 'UC1', {}, W('one')); await run(url, 'UC6', {}, W('one')); await run(url, 'UC1', {}, W('two'));
    assert.equal((await (await get(url, '/api/runs', W('one'))).json()).count, 2);
    const r = await post(url, '/api/reset', {}, W('one')); assert.deepEqual(await r.json(), { reset: 'ok', workspace: 'one' });
    assert.equal((await (await get(url, '/api/runs', W('one'))).json()).count, 0);
    assert.equal((await (await get(url, '/api/runs', W('two'))).json()).count, 1);
    assert.equal((await run(url, 'UC1', {}, W('one'))).body.seq, 1, 'the counter restarts');
    assert.equal((await post(url, '/api/reset', { x: 1 })).status, 400);
    assert.equal((await post(url, '/api/reset', {}, W('never-used'))).status, 200);
  });
  const ws = createWorkspaces({ defaultMode: 'mock' });
  await ws.write('m', (s) => { s.mode = 'live'; s.runs.push({}); });
  await ws.reset('m'); assert.deepEqual(ws.peek('m'), { mode: 'mock', seq: 0, runs: [] });
  await ws.reset('absent'); assert.equal(ws.size(), 1, 'resetting an unknown workspace creates nothing');
});

test('the workspace id: default, valid ids kept apart, bad or credential-looking ids refused (400) without echo', async () => {
  await withServer(async (url) => {
    assert.equal((await run(url, 'UC1')).body.workspace, 'default');
    assert.equal((await run(url, 'UC1', {}, W('team-a'))).body.workspace, 'team-a');
    for (const bad of ['UPPER', 'has space', 'x'.repeat(41), '', 'a/b', 'deadbeef'.repeat(6), 'abcdefghij1234567890klmnop']) {
      const r = await run(url, 'UC1', {}, { 'x-workspace': bad }); assert.equal(r.status, 400, bad); assert.equal(r.body.error, 'bad_workspace'); assert.ok(!JSON.stringify(r.body).includes(bad || 'zzzz'));
    }
  });
});

test('caps: new workspaces are refused (429) at the cap and nothing is evicted; a workspace holds at most 100 runs (409) until Reset', async () => {
  const ws = createWorkspaces({ max: 2 });
  await withServer(async (url) => {
    assert.equal((await run(url, 'UC1', {}, W('a'))).status, 200); assert.equal((await run(url, 'UC1', {}, W('b'))).status, 200);
    const c = await run(url, 'UC1', {}, W('c')); assert.equal(c.status, 429); assert.equal(c.body.error, 'too_many_workspaces');
    assert.equal((await run(url, 'UC1', {}, W('a'))).status, 200, 'an existing workspace is untouched by the refusal');
    assert.equal((await get(url, '/api/runs', W('a'))).status, 200);
  }, { workspaces: ws });
  await withServer(async (url) => {
    for (let i = 0; i < MAX_RUNS; i++) assert.equal((await run(url, 'UC24', {}, W('full'))).status, 200);
    const over = await run(url, 'UC24', {}, W('full')); assert.equal(over.status, 409); assert.equal(over.body.error, 'workspace_full');
    assert.equal((await (await get(url, '/api/runs', W('full'))).json()).count, MAX_RUNS, 'nothing was dropped to make room');
    await post(url, '/api/reset', {}, W('full'));
    assert.equal((await run(url, 'UC24', {}, W('full'))).status, 200);
  });
});

test('every answer is JSON, every unknown route is a fixed 404 that does not echo the path, errors are fixed text', async () => {
  await withServer(async (url) => {
    for (const [m, p] of [['GET', '/api/nope'], ['POST', '/api/nope'], ['DELETE', '/api/run/UC1'], ['PUT', '/api/health'], ['GET', '/nope'], ['GET', '/api/run/UC1'], ['PATCH', '/api/usecases']]) {
      const r = await fetch(`${url}${p}`, { method: m, headers: { origin: url } }); const t = await r.text();
      assert.ok([404, 405].includes(r.status), `${m} ${p} ${r.status}`); assert.doesNotThrow(() => JSON.parse(t), `${m} ${p}: ${t.slice(0, 40)}`); assert.ok(!t.includes('nope') && !t.includes('Cannot'));
    }
    const r = await fetch(`${url}/api/${SECRETS.github}`); assert.equal(r.status, 404); assert.ok(!(await r.text()).includes(NEEDLE.github));
    assert.equal((await get(url, '/api/info')).headers.get('x-content-type-options'), 'nosniff');
    const info = await (await get(url, '/api/info')).json();
    assert.equal(info.total, 87); assert.equal(info.guards.mockSignIn, 'allowed'); assert.equal(info.guards.live, 'refused'); assert.deepEqual(info.modes, ['mock', 'live']);
  });
});

test('run responses carry the traceparent header and continue an incoming trace', async () => {
  await withServer(async (url) => {
    const tp = `00-${'12'.repeat(16)}-${'34'.repeat(8)}-01`;
    const r = await post(url, '/api/run/UC6', {}, { traceparent: tp });
    assert.match(r.headers.get('traceparent'), new RegExp(`^00-${'12'.repeat(16)}-[0-9a-f]{16}-01$`));
    const j = await r.json(); assert.equal(j.run.traceId, '12'.repeat(16)); assert.ok(j.run.hops.every((h) => h.traceparent.split('-')[1] === '12'.repeat(16)));
  });
});

test('a run without a valid traceparent starts its own trace: two runs, two trace ids (a missing, malformed or all-zero header)', async () => {
  await withServer(async (url) => {
    const seen = new Set();
    for (const h of [{}, {}, { traceparent: 'nope' }, { traceparent: `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01` }, { traceparent: `00-${'A'.repeat(32)}-${'b'.repeat(16)}-01` }]) {
      const { status, body } = await run(url, 'UC6', {}, h);
      assert.equal(status, 200); assert.match(body.run.traceId, /^[0-9a-f]{32}$/); assert.notEqual(body.run.traceId, '0'.repeat(32));
      assert.ok(body.run.hops.every((x) => x.traceparent.split('-')[1] === body.run.traceId));
      seen.add(body.run.traceId);
    }
    assert.equal(seen.size, 5, 'every run without a valid header gets a different trace id');
  });
});

test('the use-case list answers fast enough to be a page (all 87 with their text)', async () => {
  await withServer(async (url) => {
    const t = Date.now(); const r = await get(url, '/api/usecases'); const j = await r.json();
    assert.equal(j.total, 87); assert.ok(Date.now() - t < 3000);
  });
});

test('review fix: a guided run over HTTP reports computed false and matchesExpected null', async () => {
  await withServer(async (url) => {
    const { status, body } = await run(url, 'UC-LEARN1');
    assert.equal(status, 200); assert.equal(body.run.computed, false); assert.equal(body.run.matchesExpected, null); assert.equal(body.run.kind, 'guided');
  });
});

test('step 2: every use case says whether it is guided (33) or computed (54), and agrees with what a run then does; labInputs are the lab-invented inputs', async () => {
  await withServer(async (url) => {
    const j = await (await get(url, '/api/usecases')).json();
    const all = j.tracks.flatMap((t) => t.usecases);
    assert.equal(all.filter((u) => u.guided).length, 33); assert.equal(all.filter((u) => !u.guided).length, 54);
    for (const id of ['UC1', 'UC7', 'UC-LEARN2', 'UC43']) {
      const u = all.find((x) => x.id === id);
      const r = (await run(url, id)).body;
      assert.equal(r.run.kind === 'guided', u.guided, id);
    }
    assert.deepEqual(all.find((u) => u.id === 'UC7').labInputs, { amount: 600 });
    assert.deepEqual(all.find((u) => u.id === 'UC5').labInputs, { event: 'insufficient-scope' });
    assert.deepEqual(all.find((u) => u.id === 'UC1').labInputs, {});
    // a copy: the engine's table is not reachable through the answer
    const again = await (await get(url, '/api/usecases/UC7')).json(); assert.deepEqual(again.usecase.labInputs, { amount: 600 });
  });
});

test('step 2: the built web app is served from the same origin with a same-origin CSP, any non-API path gets the page, and /api never does', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Customer Agent LAB</title><div id="root"></div>');
  fs.mkdirSync(path.join(dir, 'assets')); fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'export {}');
  try {
    await withServer(async (url) => {
      const page = await get(url, '/');
      assert.equal(page.status, 200); assert.match(await page.text(), /Customer Agent LAB/);
      const csp = page.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/); assert.match(csp, /script-src 'self'/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
      assert.ok(!/unsafe-eval|https?:/.test(csp), 'no eval and no foreign origin in the CSP');
      assert.equal((await get(url, '/assets/a.js')).status, 200);
      assert.match(await (await get(url, '/page-consent')).text(), /<div id="root">/);
      const miss = await get(url, '/api/nope'); assert.equal(miss.status, 404); assert.deepEqual(await miss.json(), { error: 'not_found' });
      assert.ok((await get(url, '/api/health')).headers.get('content-security-policy'), 'API answers carry it too');
    }, { webDist: dir });
    await withServer(async (url) => { assert.equal((await get(url, '/')).status, 404, 'no build, no page'); });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
