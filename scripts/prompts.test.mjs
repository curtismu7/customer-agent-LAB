// Every What to type prompt, run through the same Scripted matcher the chat uses (web/src/chat.js matchPrompt, fed the list GET /api/prompts
// serves), must select exactly the use case this file declares for it, and that use case must reach its catalog outcome in the engine (the chat
// runs it; a hand-off prompt answers with the hand-off card and Preview here runs it). The expected use case is written out here, independently of
// data/prompts.json, so swapping two prompts' use cases in the data fails. There is no server-side matcher: the server only serves the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPrompt } from '../web/src/chat.js';
import { PROMPTS, promptsFor, routeOf } from '../server/src/routes.js';
import { findUseCase } from '../server/src/manifest.js';
import { runUseCase } from '../server/src/flow.js';
import { loadCast } from '../server/src/cast.js';

const EXPECT = {
  banking: {
    'show my balance': 'UC1', 'show my mortgage': 'UC33', 'transfer $600 from checking to savings': 'UC7', 'transfer $300 from checking to savings': 'UC8',
    'transfer $2500 from checking to savings': 'UC6', 'check my sensitive account details for group entitlement': 'UC9',
    'check my sensitive account details for tier access': 'UC21', 'Check for unusual patterns in my recent activity': 'UC34',
    'Explain why my last blocked action was denied and walk me through the token chain': 'UC35', 'What branches are near me?': 'UC24',
    'hand off to a specialist': 'UC2', 'simulate an agent identity mismatch': 'UC2.6', 'Can you waive the fee on my checking account?': 'UC28',
  },
  healthcare: {
    'show my coverage': 'UC1', 'show my dental coverage': 'UC33', 'pay $600 toward my patient bill': 'UC7', 'pay $300 toward my patient bill': 'UC8',
    'pay $2500 toward my patient bill': 'UC6', 'check my sensitive patient records for group entitlement': 'UC9',
    'check my sensitive patient records for tier access': 'UC21', 'Check for unusual patterns in my recent claims': 'UC34',
    'Explain why my last blocked request was denied and walk me through the token chain': 'UC35', 'What clinics are near me?': 'UC24',
    'hand this off to a care specialist': 'UC2', 'simulate a care agent identity mismatch': 'UC2.6', 'Can you waive the fee on my patient bill?': 'UC28',
  },
  retail: {
    'show my orders': 'UC1', 'show my gift card balance': 'UC33', 'check out $600 with store credit': 'UC7', 'check out $300 with store credit': 'UC8',
    'check out $2500 with store credit': 'UC6', 'check my sensitive order history for group entitlement': 'UC9',
    'check my sensitive order history for tier access': 'UC21', 'Check for unusual patterns in my recent orders': 'UC34',
    'Explain why my last blocked checkout was denied and walk me through the token chain': 'UC35', 'What stores are near me?': 'UC24',
    'pass my order question to a specialist': 'UC2', 'simulate a shopping agent identity mismatch': 'UC2.6', 'Can you waive the restocking fee on my order?': 'UC28',
  },
};

test('the prompts shown are exactly the ones declared here, vertical by vertical', () => {
  assert.deepEqual(Object.keys(PROMPTS.verticals).sort(), Object.keys(EXPECT).sort());
  for (const [v, want] of Object.entries(EXPECT)) assert.deepEqual(promptsFor(v).map((p) => p.text).sort(), Object.keys(want).sort(), v);
});

test('every prompt text, through the chat matcher, selects exactly its declared use case, and that run reaches the catalog outcome', () => {
  let n = 0;
  for (const [vertical, want] of Object.entries(EXPECT)) {
    const list = promptsFor(vertical); // what GET /api/prompts serves and the chat matches against
    for (const p of list) {
      const m = matchPrompt(p.text, list);
      assert.ok(m, `${vertical} "${p.text}" matches a prompt`);
      assert.equal(m.how, 'exact', `${vertical} "${p.text}"`);
      assert.equal(m.uc, want[p.text], `${vertical} "${p.text}" selects ${want[p.text]}`);
      const uc = findUseCase(m.uc);
      const r = runUseCase(uc, { cast: loadCast(null, vertical), vertical, seed: 'prompts' });
      assert.equal(r.kind, 'flow', `${vertical} ${m.uc} is computed`);
      assert.equal(r.outcome, uc.expectedOutcome, `${vertical} ${m.uc} reaches ${uc.expectedOutcome}`);
      assert.equal(r.matchesExpected, true, `${vertical} ${m.uc}`);
      n += 1;
    }
    // the "Opens its own app" group: every one routes Hand off, so the chat answers with the hand-off card
    const away = list.filter((p) => p.route === 'Hand off');
    assert.ok(away.length >= 1, `${vertical} has an Opens its own app prompt`);
    for (const p of away) assert.equal(routeOf(p.uc).route, 'Hand off', `${vertical} ${p.uc}`);
  }
  assert.equal(n, 39);
});

test('mutation: swapping two prompts\' use cases is caught', () => {
  const list = promptsFor('healthcare').map((p) => ({ ...p }));
  const a = list.findIndex((p) => p.uc === 'UC1'); const b = list.findIndex((p) => p.uc === 'UC7');
  [list[a].uc, list[b].uc] = [list[b].uc, list[a].uc];
  const wrong = list.filter((p) => matchPrompt(p.text, list).uc !== EXPECT.healthcare[p.text]);
  assert.equal(wrong.length, 2);
});
