import test from 'node:test';
import assert from 'node:assert/strict';
import { findUseCase } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { assertRunObservability, classify } from '../src/runObservability.js';
import { buildRunRecord, decisionLines, clean, newRunId, mockLayers, realLayers } from '../src/runObs.js';

const mockRun = (id = 'UC1', extra = {}) => runUseCase(findUseCase(id), { cast: VERTICALS.banking, vertical: 'banking', seed: 'run', ...extra });
const PRODUCTS = ['pingfederate', 'pinggateway', 'privilege-gateway', 'privilege-siem', 'promptguard', 'mcp-server'];
// A word the shared matchers read as a decision or a secret: none may appear on a stdout line this lab writes.
const MATCHER_WORD = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served/i;

test('a computed Mock run builds a record of simulated rows only, and the record passes the shared assertions', async () => {
  const run = mockRun('UC1');
  const at = Date.parse('2026-11-24T10:00:00.000Z');
  const lines = [];
  const record = await buildRunRecord({ run, mode: 'mock', runId: 'run-a1', startedAt: at, endedAt: at, write: (l) => lines.push(l) });
  assert.ok(record, 'a flow run has a record');
  assert.equal(record.source, 'mock');
  assert.deepEqual(assertRunObservability(record), []);
  for (const r of record.rows) {
    assert.ok(['simulated', 'not-logged'].includes(r.origin), 'every Mock row is simulated (or a not-logged note), never logged or response');
    if (r.origin === 'simulated') assert.equal(r.at, new Date(at).toISOString(), 'one stamp for the whole Mock run: the mock has no per-hop clock');
  }
  assert.ok(record.rows.length > 0);
});

test('each allowed, refused or blocked row is one stdout line, at the row time, and nothing else is written', async () => {
  const run = mockRun('UC1');
  const at = Date.parse('2026-11-24T10:00:00.000Z');
  const lines = [];
  const record = await buildRunRecord({ run, mode: 'mock', runId: 'run-a2', startedAt: at, endedAt: at, write: (l) => lines.push(l) });
  const decisions = record.rows.filter((r) => ['allowed', 'refused', 'blocked'].includes(r.outcome));
  assert.equal(lines.length, decisions.length, 'one line per policy-point decision');
  for (const [i, r] of decisions.entries()) {
    assert.ok(lines[i].startsWith(`${r.atExact} customer-agent-lab decision step=${r.layer} actor=simulated result=`), lines[i]);
  }
});

test('every stdout line is read as no decision by the shared classifier, for every product, and carries no matcher word', async () => {
  const run = mockRun('UC1');
  const at = Date.parse('2026-11-24T10:00:00.000Z');
  const lines = [];
  await buildRunRecord({ run, mode: 'mock', runId: 'run-a3', startedAt: at, endedAt: at, write: (l) => lines.push(l) });
  assert.ok(lines.length > 0, 'the UC1 run writes at least one decision line');
  for (const line of lines) {
    assert.doesNotMatch(line, MATCHER_WORD);
    for (const product of PRODUCTS) assert.equal(classify({ product, message: line }), null, `${product}: ${line}`);
  }
});

test('a hostile run id cannot add a second key or a second line', async () => {
  const run = mockRun('UC1');
  const at = Date.parse('2026-11-24T10:00:00.000Z');
  const lines = [];
  await buildRunRecord({ run, mode: 'mock', runId: 'x y\nresult=passed refused', startedAt: at, endedAt: at, write: (l) => lines.push(l) });
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.equal(line.split('\n').length, 1);
    assert.doesNotMatch(line, /run=x y/);
    assert.match(line, / run=xyresultpassedrefused$/);
  }
  assert.equal(clean('a b\nc=d'), 'abcd');
});

test('a throwing writer costs its own line and nothing else: the record is the same as with a healthy writer', async () => {
  const run = mockRun('UC1');
  const at = Date.parse('2026-11-24T10:00:00.000Z');
  const healthy = await buildRunRecord({ run, mode: 'mock', runId: 'run-b1', startedAt: at, endedAt: at, write: () => {} });
  let n = 0;
  const errors = [];
  const broken = await buildRunRecord({ run, mode: 'mock', runId: 'run-b1', startedAt: at, endedAt: at, write: () => { n += 1; if (n === 2) { const e = new Error('disk full: /secret/path'); e.name = 'EIO'; throw e; } }, error: (c) => errors.push(c) });
  assert.deepEqual(broken.rows, healthy.rows, 'rows are unchanged by a failed write');
  assert.deepEqual(errors, ['EIO'], 'the error is named by its name only, never its message');
});

test('a mode mismatch or a run kind with no decisions builds no record', async () => {
  const run = mockRun('UC1');
  const at = Date.parse('2026-11-24T10:00:00.000Z');
  assert.equal(await buildRunRecord({ run, mode: 'real', runId: 'r', startedAt: at, endedAt: at, write: () => {} }), null, 'a Mock run is not a Real record');
  assert.equal(await buildRunRecord({ run: { ...run, kind: 'guided' }, mode: 'mock', runId: 'r', startedAt: at, endedAt: at, write: () => {} }), null, 'a guided run has no decisions');
  assert.equal(await buildRunRecord({ run: { ...run, kind: 'live' }, mode: 'real', runId: 'r', startedAt: at, endedAt: at, write: () => {} }), null, 'an identity-provider-only run has no record');
});

test('a Real run is response rows only, the gateway row carries the one decision, and the Privilege row comes from the audit trail', async () => {
  const at = Date.parse('2026-11-24T10:00:00.000Z');
  const run = {
    kind: 'real', persona: null,
    hops: [
      { kind: 'sign-in', verdict: 'ok', label: 'Sign-in [REAL]' },
      { kind: 'actor-token', verdict: 'ok', label: 'Agent token [REAL]' },
      { kind: 'token-exchange', verdict: 'ok', label: 'Token exchange 1 [REAL]' },
      { kind: 'gateway-check', verdict: 'deny', label: 'Agent Gateway [REAL]' },
      { kind: 'authorize-decision', verdict: 'deny', label: 'Authorize decision [REAL]' },
      { kind: 'api-call', verdict: 'skip', source: 'not-run', label: 'API' },
    ],
    gatewayTrace: [{ step: 1, title: 'tools/call', status: 403, trace: { decisions: [{ id: 'audit-trail', evidence: 'the X-Gw-Audit-Trail header says DENY' }] } }],
  };
  const lines = [];
  const record = await buildRunRecord({ run, mode: 'real', runId: 'run-r1', startedAt: at, endedAt: at + 500, write: (l) => lines.push(l) });
  assert.deepEqual(assertRunObservability(record), []);
  assert.equal(record.source, 'real');
  for (const r of record.rows) assert.ok(['response', 'not-logged'].includes(r.origin), 'no row is logged: this lab reads no logs');
  const gw = record.rows.filter((r) => r.layer === 'gateway');
  assert.deepEqual(gw.map((r) => r.outcome), ['refused'], 'one policy decision for the gateway');
  assert.equal(record.rows.find((r) => r.layer === 'authorize').outcome, 'info', 'the Authorize row is read from the gateway reply, so it is information');
  assert.equal(record.rows.find((r) => r.layer === 'privilege').outcome, 'info');
  assert.equal(record.coverage.resource, 'not-logged', 'a not-run hop is not a row');
  assert.equal(lines.length, 1, 'only the refused gateway row is a stdout line');
  assert.match(lines[0], /step=gateway actor=response result=stopped run=run-r1$/);
});

test('a Real run with no audit trail header says so for the Privilege layer', () => {
  const layers = realLayers({ hops: [], gatewayTrace: [] }, Date.now());
  const priv = layers.find((l) => l.layer === 'privilege');
  assert.deepEqual(priv.responses, []);
  assert.match(priv.reason, /no X-Gw-Audit-Trail header/);
});

test('mockLayers names all six layers and gives a reason for each one the mock did not compute', () => {
  const layers = mockLayers({ persona: null, hops: [] }, Date.now());
  assert.deepEqual(layers.map((l) => l.layer), ['person', 'agent', 'authorize', 'privilege', 'gateway', 'resource']);
  for (const l of layers) { assert.deepEqual(l.simulated, []); assert.ok(l.reason); }
});

test('run ids are fresh and carry no counter or name', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^run-[0-9a-f]{12}$/);
});
