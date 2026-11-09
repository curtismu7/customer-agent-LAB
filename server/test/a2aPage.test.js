// Owner, 2026-11-09: keep the Agent to agent page (#page-a2a). It opens for the A2A use cases (Preview here on a hand-off) and shows the
// delegation hops of the run. These pins fail if a later change stops UC2 opening it or drops the two delegation hops it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';

test('the A2A use cases open the Agent to agent page, and UC2 still runs both delegation hops', () => {
  const opensA2a = MANIFEST.usecases.filter((u) => u.opens === 'a2a').map((u) => u.id).sort();
  assert.deepEqual(opensA2a, ['UC2', 'UC2.5', 'UC2.6', 'UC2.7', 'UC37', 'UC46', 'UC46A', 'UC47'].sort());
  const uc = MANIFEST.usecases.find((u) => u.id === 'UC2');
  const run = runUseCase(uc, { cast: VERTICALS.banking, vertical: 'banking', seed: 'run' });
  assert.equal(run.outcome, 'PERMIT');
  assert.deepEqual(run.hops.filter((h) => h.kind.startsWith('a2a-')).map((h) => h.kind), ['a2a-exchange-1', 'a2a-exchange-2', 'a2a-agent-card', 'a2a-protocol-message']);
});
