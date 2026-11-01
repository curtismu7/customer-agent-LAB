import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildManifest, deriveNeeds, deriveOpens, LINK_OUT, TRACKS, NEEDS, OPENS } from './gen-manifest.mjs';
import { MANIFEST } from '../server/src/manifest.js';

const uc = (o = {}) => ({ id: 'UCX', track: 'controls', title: 't', buyerStory: 'b', pingOneSolution: 's', trigger: { type: 'chip', text: 'x' }, expectedOutcome: 'PERMIT', evidence: { tokenChain: [], activity: [] }, maturity: 'works', productRoles: {}, primaryTool: 'x', codeRefs: ['/secret/path'], owasp: {}, whatToSay: 'w', perVertical: { a: 1 }, ...o });

test('the generator copies ONLY the listed fields and drops everything else from the source', () => {
  const m = buildManifest([uc()], { repo: 'r', file: 'f', commit: 'c' });
  assert.deepEqual(Object.keys(m.usecases[0]).sort(), ['buyerStory', 'evidence', 'expectedOutcome', 'flag', 'id', 'linkOut', 'maturity', 'needs', 'opens', 'pingOneSolution', 'primaryTool', 'productRoles', 'title', 'track', 'trigger']);
  assert.ok(!JSON.stringify(m).includes('/secret/path')); assert.deepEqual(m.source, { repo: 'r', file: 'f', commit: 'c' });
  assert.equal(buildManifest([uc({ primaryTool: '' })], {}).usecases[0].primaryTool, null);
});

test('needs: from productRoles, the chain, the outcome and the maturity flag; always in the fixed order and in range', () => {
  assert.deepEqual(deriveNeeds(uc({ productRoles: { gw: 'x', idp: 'y' } })), ['idp', 'gw']);
  assert.deepEqual(deriveNeeds(uc({ evidence: { tokenChain: ['a2a-exchange1'], activity: [] } })), ['a2a']);
  assert.deepEqual(deriveNeeds(uc({ title: 'A2A hand off' })), ['a2a']);
  assert.deepEqual(deriveNeeds(uc({ expectedOutcome: 'STEP_UP' })), ['mfa']); assert.deepEqual(deriveNeeds(uc({ expectedOutcome: 'HITL_REQUIRED' })), ['mfa']);
  assert.deepEqual(deriveNeeds(uc({ maturity: 'flag:ciba_enabled' })), ['mfa']);
  assert.deepEqual(deriveNeeds(uc({ productRoles: { weird: 'x', privilege: 'p' } })), ['privilege']);
  for (const n of deriveNeeds(uc({ productRoles: { llm: 1, bff: 1, mfa: 1, authz: 1 } }))) assert.ok(NEEDS.includes(n));
});

test('opens: the first match of approval, consent, a2a, group-board, obo, learning-link, else none', () => {
  assert.equal(deriveOpens(uc({ expectedOutcome: 'STEP_UP' })), 'approval'); assert.equal(deriveOpens(uc({ title: 'CIBA approval' })), 'approval');
  assert.equal(deriveOpens(uc({ evidence: { tokenChain: ['ciba-poll'], activity: [] } })), 'approval');
  assert.equal(deriveOpens(uc({ evidence: { tokenChain: ['token-exchange'], activity: [] }, buyerStory: 'needs consent' })), 'consent');
  assert.equal(deriveOpens(uc({ buyerStory: 'needs consent' })), 'none', 'consent needs an exchange step');
  assert.equal(deriveOpens(uc({ title: 'A2A delegation' })), 'a2a'); assert.equal(deriveOpens(uc({ title: 'Group check' })), 'group-board');
  assert.equal(deriveOpens(uc({ buyerStory: 'a poisoned tool' })), 'none', 'no use case opens a hostile-MCP page'); assert.equal(deriveOpens(uc({ title: 'On-behalf-of' })), 'obo');
  assert.equal(deriveOpens(uc({ track: 'learn' })), 'learning-link'); assert.equal(deriveOpens(uc()), 'none');
  assert.ok(OPENS.includes('none') && OPENS.length === 7);
});

test('flag comes from maturity; linkOut only from the lab-reading table; the redaction runs and is counted', () => {
  assert.equal(buildManifest([uc({ maturity: 'flag:ff_dpop' })], {}).usecases[0].flag, 'ff_dpop'); assert.equal(buildManifest([uc({ maturity: 'needs-build' })], {}).usecases[0].flag, null);
  assert.equal(buildManifest([uc({ id: 'UC-LEARN3' })], {}).usecases[0].linkOut, 'mcp-tools'); assert.equal(buildManifest([uc({ id: 'UC-LEARN1' })], {}).usecases[0].linkOut, null);
  assert.equal(buildManifest([uc({ id: '__proto__' })], {}).usecases[0].linkOut, null);
  const m = buildManifest([uc({ title: 'The Air Canada pattern' })], {});
  assert.ok(!m.usecases[0].title.includes('Air Canada')); assert.equal(m.meta.redactions, 1);
});

test('the track table in the generator is the 15/23/16/4/8/11/8/2 split, and the link-out table names only learn-track entries and UC14b', () => {
  assert.deepEqual(TRACKS, { foundations: 15, learn: 23, controls: 16, hitl: 4, demo: 8, attacks: 11, tools: 8, nhi: 2 });
  for (const id of Object.keys(LINK_OUT)) { const u = MANIFEST.usecases.find((x) => x.id === id); assert.ok(u, id); assert.ok(u.track === 'learn', id); assert.equal(u.linkOut, LINK_OUT[id]); }
});

test('the committed manifest equals a fresh generation from the source when the source is available (CAL_SOURCE_USECASES); otherwise this check is skipped', async (t) => {
  const src = process.env.CAL_SOURCE_USECASES;
  if (!src || !fs.existsSync(src)) return t.skip('no source file given');
  const { readSource } = await import('./gen-manifest.mjs');
  const { raw, source } = readSource(src);
  assert.deepEqual(buildManifest(raw, MANIFEST.source).usecases, MANIFEST.usecases, 'same fields from the same catalog');
  assert.equal(source.repo, MANIFEST.source.repo);
});

test('review fix: the three weak link-outs (UC-LEARN4, UC-PAM-SETUP, UC-PAM-SCRIPT) are gone, six remain, in the table and in the committed manifest', () => {
  for (const id of ['UC-LEARN4', 'UC-PAM-SETUP', 'UC-PAM-SCRIPT']) {
    assert.ok(!Object.hasOwn(LINK_OUT, id), id);
    assert.equal(MANIFEST.usecases.find((x) => x.id === id).linkOut, null, id);
  }
  assert.equal(Object.keys(LINK_OUT).length, 6);
  assert.equal(MANIFEST.usecases.filter((u) => u.linkOut).length, 6);
});
