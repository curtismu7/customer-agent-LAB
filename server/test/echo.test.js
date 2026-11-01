// A credential the visitor types must come back in NO response field, hop pane or error: tested by typing every credential shape into every field,
// query, path, header and unknown key of every endpoint, and searching every answer, the state afterwards and the process output for it.
// Masking is a heuristic (see docs/safety.md): this test covers the shapes in secrets.js, not every possible secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, withServer } from './helpers.js';
import { SECRETS, NEEDLE, PLAIN } from './secrets.js';

const e = encodeURIComponent;
const NEEDLES = Object.entries(SECRETS).map(([k, raw]) => ({ name: k, raw, probe: NEEDLE[k] }));

test('typing every credential shape into every field, query, path, header and unknown key of every endpoint never echoes it', async () => {
  const out = []; const realOut = process.stdout.write.bind(process.stdout); const realErr = process.stderr.write.bind(process.stderr);
  await withServer(async (url) => {
    const sweep = async (v) => {
      const texts = [];
      const keep = async (label, r) => texts.push(`${label} ${r.status} ${await r.text()} ${[...r.headers.values()].join(' ')}`);
      const bodies = [
        ['POST', '/api/run/UC1', { vertical: v }], ['POST', '/api/run/UC1', { persona: v }], ['POST', '/api/run/UC1', { mode: v }], ['POST', '/api/run/UC1', { [v]: v }],
        ['POST', '/api/run/UC1', { vertical: 'banking', persona: 'standard', note: v }], ['POST', `/api/run/${e(v)}`, {}], ['POST', `/api/run/${e(v)}`, { vertical: v }],
        ['POST', '/api/run/UC6', { vertical: [v] }], ['POST', '/api/run/UC6', { persona: { a: v } }],
        ['PUT', '/api/mode', { mode: v }], ['PUT', '/api/mode', { [v]: v }], ['POST', '/api/reset', { [v]: v }], ['POST', '/api/reset', { reset: v }],
      ];
      for (const [m, p, b] of bodies) await keep(m, await (m === 'PUT' ? put : post)(url, p, b));
      const gets = [`/api/usecases?vertical=${e(v)}`, `/api/usecases?track=${e(v)}`, `/api/usecases?vertical=${e(v)}&track=${e(v)}`, `/api/usecases/${e(v)}`, `/api/usecases/UC1?vertical=${e(v)}`, `/api/story?vertical=${e(v)}`, `/api/diagram?name=${e(v)}&vertical=${e(v)}`, `/api/diagram?name=${e(v)}`, `/api/${e(v)}`, `/${e(v)}`, `/api/runs?x=${e(v)}`, `/api/mode?mode=${e(v)}`, `/api/health?x=${e(v)}`, `/api/info?x=${e(v)}`];
      for (const g of gets) await keep('GET', await get(url, g));
      for (const hv of [v, `a ${v}`]) await keep('H', await get(url, '/api/runs', { 'x-workspace': hv.slice(0, 40).replace(/[^\x20-\x7e]/g, '?') }));
      await keep('T', await post(url, '/api/run/UC1', {}, { traceparent: v.replace(/[^\x20-\x7e]/g, '?') }));
      await keep('A', await get(url, '/api/usecases', { authorization: `Bearer ${v}`.replace(/[^\x20-\x7e]/g, '?'), cookie: `s=${v}`.replace(/[^\x20-\x7e]/g, '?') }));
      return texts.join('\n');
    };
    process.stdout.write = (c, ...a) => { out.push(String(c)); return realOut(c, ...a); }; process.stderr.write = (c, ...a) => { out.push(String(c)); return realErr(c, ...a); };
    try {
      for (const n of NEEDLES) {
        const text = await sweep(n.raw);
        assert.ok(!text.includes(n.probe), `${n.name}: the raw value is absent from every answer: ${text.split('\n').filter((l) => l.includes(n.probe)).map((l) => l.slice(0, 160)).join(' | ')}`);
        const state = JSON.stringify([await (await get(url, '/api/runs')).json(), await (await get(url, '/api/mode')).json()]);
        assert.ok(!state.includes(n.probe), `${n.name}: absent from the state afterwards`);
      }
    } finally { process.stdout.write = realOut; process.stderr.write = realErr; }
  });
  for (const n of NEEDLES) assert.ok(!out.join('').includes(n.probe), 'nothing was logged');
});

test('field names are not echoed either: an unknown key that is itself a credential never comes back', async () => {
  await withServer(async (url) => {
    for (const n of NEEDLES) {
      for (const [m, p] of [['POST', '/api/run/UC1'], ['PUT', '/api/mode'], ['POST', '/api/reset']]) {
        const r = await (m === 'PUT' ? put : post)(url, p, { [n.raw]: 1 }); const t = await r.text();
        assert.equal(r.status, 400, p); assert.ok(!t.includes(n.probe), `${n.name} ${p}`);
      }
    }
  });
});

test('masking: the MOCK tokens of this answer are the only credential-shaped text left alone; a token the visitor typed is masked even beside them', async () => {
  const { maskDeep, maskResponseText } = await import('../src/mask.js');
  const mine = `eyJhbGciOiJFUzI1NiJ9.${'a'.repeat(40)}.${'b'.repeat(40)}`;
  const typed = SECRETS.jwt;
  const out = maskDeep({ run: { tokens: [{ raw: mine }] }, a: `Bearer ${mine}`, b: `Bearer ${typed}`, c: `${mine} and ${typed}` }, [mine]);
  assert.equal(out.a, `Bearer ${mine}`); assert.ok(!out.b.includes(NEEDLE.jwt)); assert.ok(!out.c.includes(NEEDLE.jwt)); assert.ok(out.c.startsWith(mine));
  assert.ok(!maskResponseText(`Bearer ${mine}`, []).includes(mine), 'with no allow-list the same token is masked');
  assert.ok(!maskResponseText(`tok ${mine}`, ['short']).includes(mine));
});

test('ordinary prose, ids and tool names are not masked in the use-case list (no false positives in the manifest text)', async () => {
  await withServer(async (url) => {
    const j = await (await get(url, '/api/usecases')).json();
    assert.ok(!JSON.stringify(j).includes('[masked:'));
    const s = await (await get(url, '/api/story')).json(); assert.ok(!JSON.stringify(s).includes('[masked:'));
  });
  const { maskText } = await import('../src/credentials.js');
  for (const t of PLAIN) assert.equal(maskText(t), t, t);
  const { maskDeep } = await import('../src/mask.js');
  assert.deepEqual(maskDeep({ t: 'enforces the bearer requirement; enterprise-managed-authorization: PingOne' }, [], true), { t: 'enforces the bearer requirement; enterprise-managed-authorization: PingOne' });
  assert.ok(maskDeep({ t: 'enforces the bearer requirement' }).t.includes('[masked:bearer]'), 'visitor-reachable answers keep the prose detectors');
  assert.ok(maskDeep({ t: SECRETS.github }, [], true).t.includes('[masked:github-token]'), 'static answers still mask credential shapes');
});
