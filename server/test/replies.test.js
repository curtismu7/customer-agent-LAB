import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { VERTICALS, PERSONAS, loadCast, toolFor, unfilled } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { REPLIES, proposalFor, replyFor, templateFor, valuesFor } from '../src/replies.js';
import { SITUATIONS } from '../src/situations.js';

const run = (id, vertical = 'banking', persona = 'standard') => runUseCase(findUseCase(id), { cast: loadCast(null, vertical), vertical, persona, seed: 't' });
const kindBody = (r, kind) => r.hops.find((h) => h.kind === kind && h.verdict !== 'skip')?.response?.body;
const replyOf = (r) => kindBody(r, 'agent-reply')?.reply;

// Every tool a vertical can run: the catalog's primary tools swapped for the vertical's own (toolFor), plus the everyday read tool used when a
// use case names none.
const toolsOf = (cast) => new Set([cast.castReadTool, ...MANIFEST.usecases.filter((u) => u.primaryTool).map((u) => toolFor(cast, u.primaryTool))]);

test('every tool used by any vertical has a reply template, and every {{name}} in it is filled for both personas', () => {
  for (const [v, cast] of Object.entries(VERTICALS)) {
    for (const tool of toolsOf(cast)) {
      const t = templateFor(v, tool);
      assert.equal(typeof t, 'string', `${v} ${tool}: no reply template`);
      for (const persona of PERSONAS) {
        const values = valuesFor({ cast, vertical: v, persona, tool, amount: 600, args: {} });
        assert.deepEqual(unfilled(t, values), [], `${v} ${tool} ${persona}`);
        const said = replyFor({ cast, vertical: v, persona, tool, amount: 600 });
        assert.doesNotMatch(said, /mock result|\{\{|undefined|null/, `${v} ${tool} ${persona}: ${said}`);
        assert.ok(!said.includes(tool), `${v} ${tool}: the reply does not name the tool`);
      }
    }
    for (const t of Object.values(REPLIES.proposals[v] || {})) assert.deepEqual(unfilled(t, valuesFor({ cast, vertical: v, persona: 'standard' })), [], `${v} proposal`);
  }
  for (const t of [REPLIES.fallback, REPLIES.proposalFallback]) assert.deepEqual(unfilled(t, valuesFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard' })), []);
});

test('an unknown tool gets the generic sentence, never "mock result of <tool>"', () => {
  const said = replyFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard', tool: 'no_such_tool' });
  assert.equal(said, 'Done: I checked your account and everything is in order.');
  assert.equal(proposalFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard', tool: 'no_such_tool' }), 'I have this request ready to go.');
  assert.equal(templateFor('banking', '__proto__'), null);
  assert.equal(templateFor('__proto__', 'get_account_balance'), null);
});

test('the engine replies read like a real agent, with lab-invented amounts, deterministic per vertical and persona', () => {
  assert.equal(replyOf(run('UC1')), 'Your checking balance is $4,250.00, and your savings balance is $12,800.00.');
  assert.equal(replyOf(run('UC1', 'banking', 'premium')), 'Your checking balance is $18,940.00, and your savings balance is $52,300.00.');
  assert.equal(replyOf(run('UC33')), 'Your mortgage balance is $312,450.00 at 5.25% fixed. Your next payment of $1,985.00 is due December 1.');
  assert.equal(replyOf(run('UC2')), 'Your portfolio is worth $86,300.00, up 2.4% this month, split 60% stocks, 30% bonds and 10% cash.');
  assert.equal(replyOf(run('UC22')), `Done: $${SITUATIONS.UC22.amount} moved from checking to savings.`);
  assert.match(replyOf(run('UC2.6')), /^Your portfolio is worth \$86,300\.00.* A different agent then tried the same call for you and was refused/);
  assert.equal(replyOf(run('UC1', 'healthcare')), 'You are on the Silver PPO plan: $640.00 of your $2,000.00 deductible is met, and you pay 20% coinsurance after that.');
  assert.equal(replyOf(run('UC33', 'retail')), 'Your gift card balance is $75.00, and you have $320.00 in store credit.');
  assert.equal(replyOf(run('UC1')), replyOf(run('UC1')), 'repeats exactly');
});

test('a held transfer says what the agent is ready to do with the amount; the refusal text is unchanged', () => {
  const held = run('UC7');
  assert.equal(held.outcome, 'STEP_UP');
  assert.equal(kindBody(held, 'tool-held').proposed, 'I\'m ready to move $600 from checking to savings.');
  assert.equal(replyOf(held), undefined, 'a held run has no agent reply');
  const denied = run('UC6');
  assert.equal(denied.outcome, 'DENY');
  assert.equal(kindBody(denied, 'tool-refused').reason, 'amount 2500 is in the DENY band (lab-invented threshold 2000)');
});

test('no run in any full vertical or persona says "mock result of" or leaves a {{name}} in a reply, proposal or tool result', () => {
  for (const v of Object.keys(VERTICALS)) for (const persona of PERSONAS) for (const uc of MANIFEST.usecases) {
    const r = runUseCase(uc, { cast: loadCast(null, v), vertical: v, persona, seed: 't' });
    for (const h of r.hops) {
      const s = JSON.stringify(h.response?.body ?? '');
      assert.doesNotMatch(s, /mock result of|\{\{/, `${v} ${persona} ${uc.id} ${h.kind}`);
    }
  }
});
