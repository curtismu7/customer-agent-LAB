// Owner, 2026-11-09: keep the Agent to agent page (#page-a2a). It opens for the A2A use cases (UC2 runs here; Preview here on a hand-off) and shows the
// delegation hops of the run. These pins fail if a later change stops UC2 opening it or drops the two delegation hops it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { routeOf } from '../src/routes.js';

test('the A2A use cases open the Agent to agent page, and UC2 still runs both delegation hops', () => {
  const opensA2a = MANIFEST.usecases.filter((u) => u.opens === 'a2a').map((u) => u.id).sort();
  assert.deepEqual(opensA2a, ['UC2', 'UC2.5', 'UC2.6', 'UC2.7', 'UC37', 'UC46', 'UC46A', 'UC47'].sort());
  const uc = MANIFEST.usecases.find((u) => u.id === 'UC2');
  const run = runUseCase(uc, { cast: VERTICALS.banking, vertical: 'banking', seed: 'run' });
  assert.equal(run.outcome, 'PERMIT');
  assert.deepEqual(run.hops.filter((h) => h.kind.startsWith('a2a-')).map((h) => h.kind), ['a2a-exchange-1', 'a2a-exchange-2', 'a2a-agent-card', 'a2a-protocol-message']);
});

// The page opens only after a use case runs IN this app, so at least one A2A use case must not be a Hand off (or a Guide). Owner, 2026-11-09:
// UC2 is Here + go deeper (a2a-lab) to keep #page-a2a reachable from the chat.
test('at least one A2A use case runs here, so the Agent to agent page can open from the chat; UC2 is Here + go deeper to a2a-lab', () => {
  const here = MANIFEST.usecases.filter((u) => u.opens === 'a2a' && ['Here', 'Here + go deeper'].includes(routeOf(u.id).route)).map((u) => u.id);
  assert.ok(here.length >= 1, 'no use case that opens the A2A page runs here');
  assert.deepEqual(routeOf('UC2'), { route: 'Here + go deeper', app: 'a2a-lab', basis: 'owner decision 2026-11-09' });
});
