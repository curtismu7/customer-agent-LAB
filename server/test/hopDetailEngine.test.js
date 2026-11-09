import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { validateHop } from '../src/vendor/hopDetail.mjs';
import CATALOG from '../src/vendor/hop-catalog.json' with { type: 'json' };

test('every hop of every use case, in every full vertical, is valid demo-hop/1 with catalog teaching text', () => {
  let hops = 0;
  for (const vertical of Object.keys(VERTICALS)) for (const uc of MANIFEST.usecases) {
    for (const h of runUseCase(uc, { cast: VERTICALS[vertical], vertical, seed: 'run' }).hops) {
      hops++;
      assert.deepEqual(validateHop(h, CATALOG, { tokens: 'raw' }), [], `${vertical} ${uc.id} hop ${h.n} ${h.kind}`);
    }
  }
  assert.ok(hops > 800, `only ${hops} hops`);
});

test('UC1 carries the step detail the evidence screens draw: claim diff, gateway stages, decision', () => {
  const uc = MANIFEST.usecases.find((u) => u.id === 'UC1');
  const hops = runUseCase(uc, { cast: VERTICALS.banking, vertical: 'banking', seed: 'run' }).hops;
  const ex = hops.find((h) => h.kind === 'token-exchange');
  assert.ok(ex.claimDiff.changed.includes('act'));
  assert.match(ex.fact, /scope narrowed \d+ → 1/);
  const gw = hops.find((h) => h.kind === 'gateway-check');
  assert.deepEqual(gw.stages.map((s) => s.result), gw.stages.map(() => 'pass'));
  assert.ok(gw.stages.some((s) => s.name === 'act present'));
  assert.equal(hops.find((h) => h.kind === 'authorize-decision').decision.outcome, 'PERMIT');
});

test('a gateway refusal marks the failing stage and stops there (UC5)', () => {
  const uc = MANIFEST.usecases.find((u) => u.id === 'UC5');
  const gw = runUseCase(uc, { cast: VERTICALS.banking, vertical: 'banking', seed: 'run' }).hops.find((h) => h.kind === 'gateway-check');
  const last = gw.stages.at(-1);
  assert.equal(last.result, 'fail');
  assert.match(last.note, /stopped here/);
  assert.equal(gw.fact, 'denied');
});

test('mock runs never show a client secret, even with tokens raw', () => {
  for (const uc of MANIFEST.usecases) {
    const text = JSON.stringify(runUseCase(uc, { cast: VERTICALS.banking, vertical: 'banking', seed: 'run' }).hops);
    assert.doesNotMatch(text, /"client_secret":"(?!\[write-only\])/, uc.id);
  }
});
