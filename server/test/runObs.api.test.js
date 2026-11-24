// The run record on the run routes (rule 27), against the FAKE PingOne and FAKE Agent Gateway only. Mock needs no fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReal, realConfig } from '../src/real.js';
import { assertRunObservability } from '../src/runObservability.js';
import { DEMO_PASSWORD, fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { startFakeGateway } from './fakeGateway.js';
import { post, run, withServer } from './helpers.js';

const ENV = { ALLOW_MOCK_SIGNIN: '1' };

async function withReal(gateway, fn) {
  const p1 = await startFakePingOne();
  p1.state.full = { signin: 'ok', exchange: 'ok' };
  const gw = await startFakeGateway({ behaviour: gateway, isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url), { CAL_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  const lines = [];
  try {
    await withServer((url) => fn(url, lines), { env: ENV, real, runWrite: (l) => lines.push(l) });
  } finally { await p1.close(); await gw.close(); }
}

test('a Mock run carries a simulated record in mock, and writes one stdout line per allowed, refused or blocked row', async () => {
  const lines = [];
  await withServer(async (url) => {
    const r = await run(url, 'UC1', { vertical: 'banking' }, { 'x-workspace': 'obs-mock-1' });
    assert.equal(r.status, 200);
    const o = r.body.run.observability;
    assert.equal(o.source, 'mock');
    assert.deepEqual(assertRunObservability(o), []);
    const decided = o.rows.filter((x) => ['allowed', 'refused', 'blocked'].includes(x.outcome));
    assert.equal(lines.length, decided.length);
    for (const l of lines) assert.match(l, / customer-agent-lab decision step=[a-z]+ actor=simulated result=(passed|stopped) run=run-[0-9a-f]{12}$/);
  }, { env: ENV, runWrite: (l) => lines.push(l) });
});

test('a Real run carries a response record, the gateway row is its one decision, and the record passes the shared assertions', async () => {
  await withReal('ok', async (url, lines) => {
    assert.equal((await post(url, '/api/mode', { source: 'real' }, { 'x-workspace': 'obs-real-1' })).status, 200);
    assert.equal((await post(url, '/api/signin', { password: DEMO_PASSWORD }, { 'x-workspace': 'obs-real-1' })).status, 200);
    const r = await run(url, 'UC1', { vertical: 'banking' }, { 'x-workspace': 'obs-real-1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = r.body.run.observability;
    assert.equal(o.source, 'real');
    assert.deepEqual(assertRunObservability(o), []);
    assert.ok(o.rows.every((x) => ['response', 'not-logged'].includes(x.origin)), 'no row is logged or simulated');
    assert.equal(o.rows.filter((x) => x.layer === 'gateway' && x.origin === 'response' && x.outcome === 'allowed').length, 1);
    assert.equal(lines.length, 1, 'only the gateway allow is a stdout decision line');
    assert.match(lines[0], / step=gateway actor=response result=passed run=run-[0-9a-f]{12}$/);
  });
});

test('a Real gateway refusal is a refused gateway row, and a lab-side stop is not written as an allow', async () => {
  await withReal('deny', async (url, lines) => {
    await post(url, '/api/mode', { source: 'real' }, { 'x-workspace': 'obs-real-2' });
    await post(url, '/api/signin', { password: DEMO_PASSWORD }, { 'x-workspace': 'obs-real-2' });
    const r = await run(url, 'UC1', { vertical: 'banking' }, { 'x-workspace': 'obs-real-2' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = r.body.run.observability;
    assert.deepEqual(assertRunObservability(o), []);
    const gw = o.rows.filter((x) => x.layer === 'gateway' && x.origin === 'response');
    assert.ok(gw.some((x) => x.outcome === 'refused'), 'the gateway refusal is a refused row');
    assert.ok(!gw.some((x) => x.outcome === 'allowed'));
    assert.ok(lines.every((l) => !/result=passed/.test(l) || !/step=gateway/.test(l)), 'no gateway allow line');
    assert.equal(lines.length, 1, 'the gateway refusal is the one stopped line; the tool row the gateway answered is information');
    assert.match(lines[0], / step=gateway actor=response result=stopped run=run-[0-9a-f]{12}$/);
  });
});

test('a gateway fault or a token check on the call is information: no refused row and no stdout decision line', async () => {
  for (const behaviour of ['down', 'token', 'call-down']) {
    await withReal(behaviour, async (url, lines) => {
      const ws = `obs-fault-${behaviour}`;
      await post(url, '/api/mode', { source: 'real' }, { 'x-workspace': ws });
      await post(url, '/api/signin', { password: DEMO_PASSWORD }, { 'x-workspace': ws });
      const r = await run(url, 'UC1', { vertical: 'banking' }, { 'x-workspace': ws });
      assert.equal(r.status, 200, `${behaviour}: ${JSON.stringify(r.body)}`);
      const o = r.body.run.observability;
      assert.deepEqual(assertRunObservability(o), [], behaviour);
      assert.ok(!o.rows.some((x) => x.outcome === 'refused' || x.outcome === 'blocked'), `${behaviour}: no refused or blocked row`);
      // a failed listing (down, token) is not described as an answer to it; call-down lists fine, so its listing row keeps the listing words
      if (behaviour !== 'call-down') for (const x of o.rows.filter((y) => y.layer === 'gateway')) assert.doesNotMatch(x.message, /answered the MCP session/, behaviour);
      assert.deepEqual(lines, [], `${behaviour}: no decision line`);
    });
  }
});
